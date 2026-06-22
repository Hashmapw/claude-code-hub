import { logger } from "@/lib/logger";
import { isSSEText, parseSSEData } from "@/lib/utils/sse";
import { detectUpstreamErrorFromSseOrJsonText } from "@/lib/utils/upstream-error-detection";
import type { Provider } from "@/types/provider";
import { ProxyError } from "./errors";

type StreamingGuardProvider = Pick<
  Provider,
  | "id"
  | "name"
  | "providerType"
  | "rejectStreamingContentLength"
  | "rejectStreamingZeroUsage"
  | "rejectStreamingEarlyError"
>;

type StreamingBufferGuardOptions = {
  response: Response;
  provider: StreamingGuardProvider;
  onFirstChunk?: (chunkSize: number) => void;
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
  onIdleTimeout?: () => void;
  isUpstreamTimeoutAbort?: () => boolean;
};

export type StreamingResponseGuardErrorType =
  | "streaming_content_length_rejected"
  | "streaming_zero_usage_rejected"
  | "streaming_early_error_rejected";

// 首包闸门预算：扣住 SSE 流头部探测，最多等到时间或字节上限就放行（避免无限扣住健康但慢的流）。
const EARLY_ERROR_HEAD_TIME_BUDGET_MS = 2000;
const EARLY_ERROR_HEAD_BYTE_BUDGET = 512 * 1024;

// "信封/状态"事件：出现这些不代表已出真实内容，继续等待错误或真实内容。
const STREAM_ENVELOPE_EVENT_TYPES = new Set<string>([
  "response.created",
  "response.in_progress",
  "response.queued",
  "message_start",
  "ping",
]);

type ExplicitUsageAnalysis = {
  hasInputTokens: boolean;
  hasOutputTokens: boolean;
  hasTotalTokens: boolean;
  values: number[];
};

const INPUT_USAGE_FIELDS = new Set([
  "input_tokens",
  "prompt_tokens",
  "promptTokenCount",
  "input_image_tokens",
]);

const OUTPUT_USAGE_FIELDS = new Set([
  "output_tokens",
  "completion_tokens",
  "candidatesTokenCount",
  "output_image_tokens",
]);

const TOTAL_USAGE_FIELDS = new Set(["total_tokens", "totalTokenCount"]);

const BILLABLE_USAGE_FIELDS = new Set([
  ...INPUT_USAGE_FIELDS,
  ...OUTPUT_USAGE_FIELDS,
  ...TOTAL_USAGE_FIELDS,
  "cache_creation_input_tokens",
  "cache_creation_5m_input_tokens",
  "cache_creation_1h_input_tokens",
  "cache_read_input_tokens",
  "cachedContentTokenCount",
  "cached_tokens",
  "reasoning_tokens",
  "audio_tokens",
  "thoughtsTokenCount",
  "ephemeral_5m_input_tokens",
  "ephemeral_1h_input_tokens",
  "claude_cache_creation_5_m_tokens",
  "claude_cache_creation_1_h_tokens",
]);

function buildGuardErrorBody(type: string, message: string): string {
  return JSON.stringify({
    error: {
      type,
      message,
    },
  });
}

export function shouldRejectStreamingContentLength(
  provider: Pick<StreamingGuardProvider, "rejectStreamingContentLength">,
  headers: Headers
): boolean {
  return provider.rejectStreamingContentLength === true && headers.has("content-length");
}

export function buildStreamingContentLengthRejectedError(
  provider: Pick<StreamingGuardProvider, "id" | "name">
): ProxyError {
  const message = "Provider streaming response included a Content-Length header";
  return new ProxyError(message, 503, {
    body: buildGuardErrorBody("streaming_content_length_rejected", message),
    parsed: {
      error: {
        type: "streaming_content_length_rejected",
        message,
      },
    },
    providerId: provider.id,
    providerName: provider.name,
  });
}

export function buildStreamingZeroUsageRejectedError(
  provider: Pick<StreamingGuardProvider, "id" | "name">
): ProxyError {
  const message = "Provider streaming response reported explicit zero usage";
  return new ProxyError(message, 503, {
    body: buildGuardErrorBody("streaming_zero_usage_rejected", message),
    parsed: {
      error: {
        type: "streaming_zero_usage_rejected",
        message,
      },
    },
    providerId: provider.id,
    providerName: provider.name,
  });
}

export function buildStreamingEarlyErrorRejectedError(
  provider: Pick<StreamingGuardProvider, "id" | "name">,
  detail?: string
): ProxyError {
  const base = "Provider streaming response emitted an error before any content";
  const message = detail ? `${base}: ${detail}` : base;
  return new ProxyError(message, 503, {
    body: buildGuardErrorBody("streaming_early_error_rejected", message),
    parsed: {
      error: {
        type: "streaming_early_error_rejected",
        message,
      },
    },
    providerId: provider.id,
    providerName: provider.name,
  });
}

export function getStreamingResponseGuardErrorType(
  error: ProxyError
): StreamingResponseGuardErrorType | null {
  const parsed = error.upstreamError?.parsed;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const root = parsed as Record<string, unknown>;
  const errorObject = root.error;
  if (!errorObject || typeof errorObject !== "object") {
    return null;
  }

  const type = (errorObject as Record<string, unknown>).type;
  if (
    type === "streaming_content_length_rejected" ||
    type === "streaming_zero_usage_rejected" ||
    type === "streaming_early_error_rejected"
  ) {
    return type;
  }

  return null;
}

export function buildStreamingGuardTimeoutError(params: {
  provider: Pick<StreamingGuardProvider, "id" | "name">;
  timeoutType: "streaming_first_byte" | "streaming_idle";
  timeoutMs: number;
}): ProxyError {
  const isIdle = params.timeoutType === "streaming_idle";
  const message = isIdle
    ? `Provider streaming response was idle for ${params.timeoutMs}ms`
    : `Provider streaming response did not produce a first byte within ${params.timeoutMs}ms`;
  const type = isIdle ? "streaming_idle_timeout" : "timeout_error";

  return new ProxyError(message, 524, {
    body: buildGuardErrorBody(type, message),
    parsed: {
      error: {
        type,
        message,
        timeout_type: params.timeoutType,
        timeout_ms: params.timeoutMs,
      },
    },
    providerId: params.provider.id,
    providerName: params.provider.name,
  });
}

export async function rejectStreamingContentLengthIfNeeded(
  response: Response,
  provider: StreamingGuardProvider
): Promise<void> {
  if (!shouldRejectStreamingContentLength(provider, response.headers)) {
    return;
  }

  try {
    await response.body?.cancel("streaming_content_length_rejected");
  } catch (error) {
    logger.debug("ProxyForwarder: Failed to cancel Content-Length rejected stream", {
      providerId: provider.id,
      providerName: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  throw buildStreamingContentLengthRejectedError(provider);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function analyzeExplicitUsageObject(value: unknown): ExplicitUsageAnalysis {
  const analysis: ExplicitUsageAnalysis = {
    hasInputTokens: false,
    hasOutputTokens: false,
    hasTotalTokens: false,
    values: [],
  };

  const visit = (current: unknown) => {
    if (!current || typeof current !== "object") {
      return;
    }

    for (const [key, nestedValue] of Object.entries(current as Record<string, unknown>)) {
      const numericValue = toFiniteNumber(nestedValue);
      if (numericValue !== null && BILLABLE_USAGE_FIELDS.has(key)) {
        analysis.values.push(numericValue);
        if (INPUT_USAGE_FIELDS.has(key)) {
          analysis.hasInputTokens = true;
        }
        if (OUTPUT_USAGE_FIELDS.has(key)) {
          analysis.hasOutputTokens = true;
        }
        if (TOTAL_USAGE_FIELDS.has(key)) {
          analysis.hasTotalTokens = true;
        }
      }

      if (nestedValue && typeof nestedValue === "object") {
        visit(nestedValue);
      }
    }
  };

  visit(value);
  return analysis;
}

function mergeExplicitUsageAnalysis(
  target: ExplicitUsageAnalysis,
  source: ExplicitUsageAnalysis
): void {
  target.hasInputTokens = target.hasInputTokens || source.hasInputTokens;
  target.hasOutputTokens = target.hasOutputTokens || source.hasOutputTokens;
  target.hasTotalTokens = target.hasTotalTokens || source.hasTotalTokens;
  target.values.push(...source.values);
}

function isExplicitZeroUsageAnalysis(analysis: ExplicitUsageAnalysis): boolean {
  const hasCompleteUsage =
    analysis.hasTotalTokens || (analysis.hasInputTokens && analysis.hasOutputTokens);

  if (!hasCompleteUsage || analysis.values.length === 0) {
    return false;
  }

  return analysis.values.every((value) => value === 0);
}

export function hasExplicitZeroUsage(usage: unknown): boolean {
  if (!usage || typeof usage !== "object") {
    return false;
  }

  const analysis = analyzeExplicitUsageObject(usage);
  return isExplicitZeroUsageAnalysis(analysis);
}

function collectUsageCandidates(value: unknown, candidates: unknown[], depth = 0): void {
  if (!value || typeof value !== "object" || depth > 8) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUsageCandidates(item, candidates, depth + 1);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (key === "usage" || key === "usageMetadata") {
      candidates.push(nestedValue);
      continue;
    }

    collectUsageCandidates(nestedValue, candidates, depth + 1);
  }
}

function analyzeExplicitUsageInPayload(payload: unknown): ExplicitUsageAnalysis {
  const analysis: ExplicitUsageAnalysis = {
    hasInputTokens: false,
    hasOutputTokens: false,
    hasTotalTokens: false,
    values: [],
  };

  const candidates: unknown[] = [];
  collectUsageCandidates(payload, candidates);

  for (const candidate of candidates) {
    mergeExplicitUsageAnalysis(analysis, analyzeExplicitUsageObject(candidate));
  }

  return analysis;
}

export function responseTextHasExplicitZeroUsage(responseText: string): boolean {
  try {
    const parsed = JSON.parse(responseText);
    const analysis: ExplicitUsageAnalysis = {
      hasInputTokens: false,
      hasOutputTokens: false,
      hasTotalTokens: false,
      values: [],
    };

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        mergeExplicitUsageAnalysis(analysis, analyzeExplicitUsageInPayload(item));
      }
    } else {
      mergeExplicitUsageAnalysis(analysis, analyzeExplicitUsageInPayload(parsed));
    }

    return isExplicitZeroUsageAnalysis(analysis);
  } catch {
    // Fall through to SSE parsing.
  }

  if (!isSSEText(responseText)) {
    return false;
  }

  const analysis: ExplicitUsageAnalysis = {
    hasInputTokens: false,
    hasOutputTokens: false,
    hasTotalTokens: false,
    values: [],
  };

  const events = parseSSEData(responseText);
  for (const event of events) {
    if (event.data === "[DONE]") {
      continue;
    }
    mergeExplicitUsageAnalysis(analysis, analyzeExplicitUsageInPayload(event.data));
  }

  return isExplicitZeroUsageAnalysis(analysis);
}

function mergeChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  if (chunks.length === 1 && chunks[0].byteLength === totalLength) {
    return chunks[0];
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function bufferStreamingResponseForZeroUsageGuard({
  response,
  provider,
  onFirstChunk,
  firstByteTimeoutMs,
  idleTimeoutMs,
  onIdleTimeout,
  isUpstreamTimeoutAbort,
}: StreamingBufferGuardOptions): Promise<Response> {
  if (provider.rejectStreamingZeroUsage !== true || !response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let sawFirstChunk = false;
  let idleTimedOut = false;
  let idleTimeoutId: NodeJS.Timeout | null = null;
  const effectiveIdleTimeoutMs = idleTimeoutMs && idleTimeoutMs > 0 ? idleTimeoutMs : 0;

  const clearIdleTimer = () => {
    if (idleTimeoutId) {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = null;
    }
  };

  const startIdleTimer = () => {
    if (effectiveIdleTimeoutMs <= 0) {
      return;
    }

    clearIdleTimer();
    idleTimeoutId = setTimeout(() => {
      idleTimedOut = true;
      try {
        onIdleTimeout?.();
      } catch {
        // ignore
      }
      reader.cancel("streaming_idle_timeout").catch((error) => {
        logger.debug("ProxyForwarder: Failed to cancel idle timed out stream guard reader", {
          providerId: provider.id,
          providerName: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, effectiveIdleTimeoutMs);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      if (!sawFirstChunk) {
        sawFirstChunk = true;
        onFirstChunk?.(value.byteLength);
      }

      startIdleTimer();
      chunks.push(value);
      totalLength += value.byteLength;
    }
  } catch (error) {
    if (idleTimedOut) {
      throw buildStreamingGuardTimeoutError({
        provider,
        timeoutType: "streaming_idle",
        timeoutMs: effectiveIdleTimeoutMs,
      });
    }

    if (!sawFirstChunk && isUpstreamTimeoutAbort?.()) {
      throw buildStreamingGuardTimeoutError({
        provider,
        timeoutType: "streaming_first_byte",
        timeoutMs: firstByteTimeoutMs ?? 0,
      });
    }

    throw error;
  } finally {
    clearIdleTimer();
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (idleTimedOut) {
    throw buildStreamingGuardTimeoutError({
      provider,
      timeoutType: "streaming_idle",
      timeoutMs: effectiveIdleTimeoutMs,
    });
  }

  if (!sawFirstChunk && isUpstreamTimeoutAbort?.()) {
    throw buildStreamingGuardTimeoutError({
      provider,
      timeoutType: "streaming_first_byte",
      timeoutMs: firstByteTimeoutMs ?? 0,
    });
  }

  const bodyBytes = mergeChunks(chunks, totalLength);
  const responseText = new TextDecoder().decode(bodyBytes);

  if (responseTextHasExplicitZeroUsage(responseText)) {
    throw buildStreamingZeroUsageRejectedError(provider);
  }

  return new Response(bodyBytes.slice(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * 判断已攒的 SSE 流头部里是否“已经开始出真实内容”（非错误、非信封事件）。
 * 一旦出现真实内容就认定本次流健康、放行透传。
 */
function streamingHeadHasContent(headText: string): boolean {
  if (!isSSEText(headText)) {
    return false;
  }
  for (const evt of parseSSEData(headText)) {
    if (evt.data === "[DONE]") {
      return true;
    }
    if (!evt.data || typeof evt.data !== "object") {
      continue;
    }
    const type = (evt.data as Record<string, unknown>).type;
    // 错误事件由 detectUpstreamError 单独处理，这里不算“内容”。
    if (type === "error") {
      continue;
    }
    if (typeof type === "string" && STREAM_ENVELOPE_EVENT_TYPES.has(type)) {
      continue;
    }
    // 其它结构化事件（含无 type 的 OpenAI chat chunk / Gemini candidates）= 已出内容。
    return true;
  }
  return false;
}

/**
 * 首包闸门：开关开启时，扣住 SSE 流头部探测——
 * - 出真实内容前若上游报错（detectUpstreamError 命中，含 {"type":"error"} / event:error）→ 抛 503 guard
 *   错误，forwarder 切换到后续供应商（本次请求级故障转移，客户端看不到这个错误）；
 * - 出现第一个真实内容事件 / 超过时间或字节预算 → 判健康，把“已攒头部 + 剩余流”重组成新 Response 放行透传。
 *
 * 仅作用于 SSE（text/event-stream）响应；开关关闭、无 body 或非 SSE 时原样返回，零改动。首包延迟有上界
 * （EARLY_ERROR_HEAD_TIME_BUDGET_MS）。和现有 guard 一样在 forwarder 内同步处理、不发心跳。
 */
export async function bufferStreamingHeadForEarlyErrorGuard({
  response,
  provider,
  onFirstChunk,
}: {
  response: Response;
  provider: StreamingGuardProvider;
  onFirstChunk?: (chunkSize: number) => void;
}): Promise<Response> {
  const contentType = response.headers.get("content-type") || "";
  if (
    provider.rejectStreamingEarlyError !== true ||
    !response.body ||
    !contentType.includes("text/event-stream")
  ) {
    return response;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const headChunks: Uint8Array[] = [];
  let headBytes = 0;
  let headText = "";
  let sawFirstChunk = false;
  const startTime = Date.now();

  const buildEarlyErrorAndCancel = async (detail: string): Promise<ProxyError> => {
    await reader.cancel("streaming_early_error_rejected").catch(() => {
      // ignore
    });
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    return buildStreamingEarlyErrorRejectedError(provider, detail.slice(0, 200) || undefined);
  };

  try {
    while (true) {
      if (
        Date.now() - startTime >= EARLY_ERROR_HEAD_TIME_BUDGET_MS ||
        headBytes >= EARLY_ERROR_HEAD_BYTE_BUDGET
      ) {
        // 预算用尽：按健康放行（更靠后的错误属于“已出头部之后”，不在本闸门范围）。
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      if (!sawFirstChunk) {
        sawFirstChunk = true;
        try {
          onFirstChunk?.(value.byteLength);
        } catch {
          // ignore
        }
      }

      headChunks.push(value);
      headBytes += value.byteLength;
      headText += decoder.decode(value, { stream: true });

      const detected = detectUpstreamErrorFromSseOrJsonText(headText);
      if (detected.isError) {
        logger.info("ProxyForwarder: streaming head-gate caught early error, failing over", {
          providerId: provider.id,
          providerName: provider.name,
          code: detected.code,
        });
        throw await buildEarlyErrorAndCancel(detected.detail ?? detected.code);
      }
      if (streamingHeadHasContent(headText)) {
        break;
      }
    }
  } catch (error) {
    if (error instanceof ProxyError) {
      throw error;
    }
    // 读流出错（上游中断等）：释放锁后交回 forwarder 按常规错误处理。
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    throw error;
  }

  // flush 末尾多字节，并对完整头部再判一次（覆盖 done / 预算路径）。
  headText += decoder.decode();
  const finalDetected = detectUpstreamErrorFromSseOrJsonText(headText);
  if (finalDetected.isError) {
    logger.info("ProxyForwarder: streaming head-gate caught early error (final), failing over", {
      providerId: provider.id,
      providerName: provider.name,
      code: finalDetected.code,
    });
    throw await buildEarlyErrorAndCancel(finalDetected.detail ?? finalDetected.code);
  }

  // 健康：重组 = 已攒头部 + 剩余未读流，放行透传。
  const rebuiltStream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of headChunks) {
        controller.enqueue(chunk);
      }
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
          return;
        }
        if (value && value.byteLength > 0) {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {
        // ignore
      });
    },
  });

  return new Response(rebuiltStream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
