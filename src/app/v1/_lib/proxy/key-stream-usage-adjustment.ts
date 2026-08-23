import {
  normalizeStreamUsageAdjustmentConfig,
  type StreamUsageAdjustmentConfig,
} from "@/lib/key-stream-usage-adjustment-config";
import { logger } from "@/lib/logger";
import type { KeyStreamUsageAdjustmentSpecialSetting } from "@/types/special-settings";
import type { ProxySession } from "./session";

export type KeyStreamUsageAdjustmentDecision = {
  config: StreamUsageAdjustmentConfig;
  hit: boolean;
  audit: KeyStreamUsageAdjustmentSpecialSetting;
};

export type KeyStreamUsageAdjustmentOptions = {
  directCacheReadIsInputSubset?: boolean;
};

function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function shouldApplyKeyStreamUsageAdjustment(
  config: StreamUsageAdjustmentConfig,
  seed: string
): boolean {
  if (!config.enabled) return false;
  if (config.probability <= 0) return false;
  if (config.probability >= 100) return true;

  const bucket = stableHash(seed) % 10_000;
  return bucket < Math.round(config.probability * 100);
}

export function resolveKeyStreamUsageAdjustmentDecision(
  session: ProxySession
): KeyStreamUsageAdjustmentDecision | null {
  const key = session.authState?.key ?? session.messageContext?.key ?? null;
  const config = normalizeStreamUsageAdjustmentConfig(key?.streamUsageAdjustment);
  if (!key || !config?.enabled) {
    return null;
  }

  const seed = [
    key.id,
    session.messageContext?.id ?? "no-message",
    session.sessionId ?? "no-session",
    session.requestSequence ?? 1,
  ].join(":");
  const hit = shouldApplyKeyStreamUsageAdjustment(config, seed);
  const audit: KeyStreamUsageAdjustmentSpecialSetting = {
    type: "key_stream_usage_adjustment",
    scope: "response",
    hit,
    keyId: key.id,
    probability: config.probability,
    ratios: {
      inputTokens: config.inputTokensRatio,
      outputTokens: config.outputTokensRatio,
      cacheReadInputTokens: config.cacheReadInputTokensRatio,
      cacheCreationInputTokens: config.cacheCreationInputTokensRatio,
    },
  };

  return { config, hit, audit };
}

function rewriteTokenValue(value: number, ratioPercent: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.max(0, Math.round((value * ratioPercent) / 100));
}

function rewriteNumberField(
  record: Record<string, unknown>,
  field: string,
  ratioPercent: number
): boolean {
  const current = record[field];
  if (typeof current !== "number" || !Number.isFinite(current)) {
    return false;
  }

  const next = rewriteTokenValue(current, ratioPercent);
  if (next === current) {
    return false;
  }

  record[field] = next;
  return true;
}

function rewriteNestedCachedTokens(
  record: Record<string, unknown>,
  field: "input_tokens_details" | "prompt_tokens_details",
  ratioPercent: number
): boolean {
  const details = record[field];
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return false;
  }

  return rewriteNumberField(details as Record<string, unknown>, "cached_tokens", ratioPercent);
}

function rewriteCachedSubsetUsage(
  record: Record<string, unknown>,
  tokenField: "input_tokens" | "prompt_tokens",
  detailsField: "input_tokens_details" | "prompt_tokens_details",
  config: StreamUsageAdjustmentConfig
): boolean {
  const details = record[detailsField];
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return false;
  }

  const detailsRecord = details as Record<string, unknown>;
  const currentTokens = record[tokenField];
  const currentCachedTokens = detailsRecord.cached_tokens;
  if (
    typeof currentTokens !== "number" ||
    !Number.isFinite(currentTokens) ||
    typeof currentCachedTokens !== "number" ||
    !Number.isFinite(currentCachedTokens)
  ) {
    return false;
  }

  const nextCachedTokens = rewriteTokenValue(currentCachedTokens, config.cacheReadInputTokensRatio);
  const currentNonCachedTokens = Math.max(currentTokens - currentCachedTokens, 0);
  const nextNonCachedTokens = rewriteTokenValue(currentNonCachedTokens, config.inputTokensRatio);
  const nextTokens = nextNonCachedTokens + nextCachedTokens;
  let changed = false;

  if (record[tokenField] !== nextTokens) {
    record[tokenField] = nextTokens;
    changed = true;
  }
  if (detailsRecord.cached_tokens !== nextCachedTokens) {
    detailsRecord.cached_tokens = nextCachedTokens;
    changed = true;
  }

  return changed;
}

function rewriteDirectCachedSubsetUsage(
  record: Record<string, unknown>,
  config: StreamUsageAdjustmentConfig
): { changed: boolean; tokenField: "input_tokens" | "prompt_tokens" | null } {
  const tokenField =
    typeof record.prompt_tokens === "number"
      ? "prompt_tokens"
      : typeof record.input_tokens === "number"
        ? "input_tokens"
        : null;
  const currentCachedTokens = record.cache_read_input_tokens;
  if (
    !tokenField ||
    typeof record[tokenField] !== "number" ||
    !Number.isFinite(record[tokenField]) ||
    typeof currentCachedTokens !== "number" ||
    !Number.isFinite(currentCachedTokens)
  ) {
    return { changed: false, tokenField: null };
  }

  const currentTokens = record[tokenField];
  const nextCachedTokens = rewriteTokenValue(currentCachedTokens, config.cacheReadInputTokensRatio);
  const currentNonCachedTokens = Math.max(currentTokens - currentCachedTokens, 0);
  const nextNonCachedTokens = rewriteTokenValue(currentNonCachedTokens, config.inputTokensRatio);
  const nextTokens = nextNonCachedTokens + nextCachedTokens;
  let changed = false;

  if (record[tokenField] !== nextTokens) {
    record[tokenField] = nextTokens;
    changed = true;
  }
  if (record.cache_read_input_tokens !== nextCachedTokens) {
    record.cache_read_input_tokens = nextCachedTokens;
    changed = true;
  }

  return { changed, tokenField };
}

function rewriteClaudeCacheCreation(
  record: Record<string, unknown>,
  config: StreamUsageAdjustmentConfig
): boolean {
  const cacheCreation = record.cache_creation;
  let changed = false;
  let hasDetailedBuckets = false;

  if (cacheCreation && typeof cacheCreation === "object" && !Array.isArray(cacheCreation)) {
    const details = cacheCreation as Record<string, unknown>;
    const changed5m = rewriteNumberField(
      details,
      "ephemeral_5m_input_tokens",
      config.cacheCreationInputTokensRatio
    );
    const changed1h = rewriteNumberField(
      details,
      "ephemeral_1h_input_tokens",
      config.cacheCreationInputTokensRatio
    );
    hasDetailedBuckets =
      typeof details.ephemeral_5m_input_tokens === "number" ||
      typeof details.ephemeral_1h_input_tokens === "number";
    changed = changed || changed5m || changed1h;

    if (hasDetailedBuckets && typeof record.cache_creation_input_tokens === "number") {
      const total =
        (typeof details.ephemeral_5m_input_tokens === "number"
          ? details.ephemeral_5m_input_tokens
          : 0) +
        (typeof details.ephemeral_1h_input_tokens === "number"
          ? details.ephemeral_1h_input_tokens
          : 0);
      if (record.cache_creation_input_tokens !== total) {
        record.cache_creation_input_tokens = total;
        changed = true;
      }
    }
  }

  if (!hasDetailedBuckets) {
    changed =
      rewriteNumberField(
        record,
        "cache_creation_input_tokens",
        config.cacheCreationInputTokensRatio
      ) || changed;
  }

  changed =
    rewriteNumberField(
      record,
      "cache_creation_5m_input_tokens",
      config.cacheCreationInputTokensRatio
    ) || changed;
  changed =
    rewriteNumberField(
      record,
      "cache_creation_1h_input_tokens",
      config.cacheCreationInputTokensRatio
    ) || changed;
  changed =
    rewriteNumberField(
      record,
      "claude_cache_creation_5_m_tokens",
      config.cacheCreationInputTokensRatio
    ) || changed;
  changed =
    rewriteNumberField(
      record,
      "claude_cache_creation_1_h_tokens",
      config.cacheCreationInputTokensRatio
    ) || changed;

  return changed;
}

function rewriteOpenAiTotals(record: Record<string, unknown>): boolean {
  if (
    typeof record.total_tokens !== "number" ||
    (typeof record.prompt_tokens !== "number" &&
      typeof record.completion_tokens !== "number" &&
      typeof record.input_tokens !== "number" &&
      typeof record.output_tokens !== "number")
  ) {
    return false;
  }

  const total =
    (typeof record.prompt_tokens === "number"
      ? record.prompt_tokens
      : typeof record.input_tokens === "number"
        ? record.input_tokens
        : 0) +
    (typeof record.completion_tokens === "number"
      ? record.completion_tokens
      : typeof record.output_tokens === "number"
        ? record.output_tokens
        : 0);
  if (record.total_tokens === total) {
    return false;
  }

  record.total_tokens = total;
  return true;
}

function rewriteGeminiUsageMetadata(
  record: Record<string, unknown>,
  config: StreamUsageAdjustmentConfig
): boolean {
  const hasGeminiUsage =
    typeof record.promptTokenCount === "number" ||
    typeof record.candidatesTokenCount === "number" ||
    typeof record.cachedContentTokenCount === "number";
  if (!hasGeminiUsage) {
    return false;
  }

  let changed = false;
  const originalCached =
    typeof record.cachedContentTokenCount === "number" ? record.cachedContentTokenCount : 0;

  if (typeof record.promptTokenCount === "number") {
    if (typeof record.cachedContentTokenCount === "number") {
      const originalInput = Math.max(record.promptTokenCount - originalCached, 0);
      const nextInput = rewriteTokenValue(originalInput, config.inputTokensRatio);
      const nextCached = rewriteTokenValue(originalCached, config.cacheReadInputTokensRatio);
      const nextPrompt = nextInput + nextCached;
      if (record.promptTokenCount !== nextPrompt) {
        record.promptTokenCount = nextPrompt;
        changed = true;
      }
      if (record.cachedContentTokenCount !== nextCached) {
        record.cachedContentTokenCount = nextCached;
        changed = true;
      }
    } else {
      changed = rewriteNumberField(record, "promptTokenCount", config.inputTokensRatio) || changed;
    }
  }

  changed = rewriteNumberField(record, "candidatesTokenCount", config.outputTokensRatio) || changed;
  if (typeof record.promptTokenCount !== "number") {
    changed =
      rewriteNumberField(record, "cachedContentTokenCount", config.cacheReadInputTokensRatio) ||
      changed;
  }

  if (typeof record.totalTokenCount === "number") {
    const hasTotalComponent =
      typeof record.promptTokenCount === "number" ||
      typeof record.candidatesTokenCount === "number" ||
      typeof record.thoughtsTokenCount === "number";
    const nextTotal =
      (typeof record.promptTokenCount === "number" ? record.promptTokenCount : 0) +
      (typeof record.candidatesTokenCount === "number" ? record.candidatesTokenCount : 0) +
      (typeof record.thoughtsTokenCount === "number" ? record.thoughtsTokenCount : 0);
    if (hasTotalComponent && record.totalTokenCount !== nextTotal) {
      record.totalTokenCount = nextTotal;
      changed = true;
    }
  }

  return changed;
}

function rewriteDirectUsageRecord(
  record: Record<string, unknown>,
  config: StreamUsageAdjustmentConfig,
  options: KeyStreamUsageAdjustmentOptions
): boolean {
  let changed = false;

  const rewroteInputTokenSubset = rewriteCachedSubsetUsage(
    record,
    "input_tokens",
    "input_tokens_details",
    config
  );
  const rewrotePromptTokenSubset = rewriteCachedSubsetUsage(
    record,
    "prompt_tokens",
    "prompt_tokens_details",
    config
  );
  const directCachedSubset = options.directCacheReadIsInputSubset
    ? rewriteDirectCachedSubsetUsage(record, config)
    : { changed: false, tokenField: null };

  changed = rewroteInputTokenSubset || changed;
  changed = rewrotePromptTokenSubset || changed;
  changed = directCachedSubset.changed || changed;
  if (!rewroteInputTokenSubset && directCachedSubset.tokenField !== "input_tokens") {
    changed = rewriteNumberField(record, "input_tokens", config.inputTokensRatio) || changed;
  }
  changed = rewriteNumberField(record, "output_tokens", config.outputTokensRatio) || changed;
  if (!rewrotePromptTokenSubset && directCachedSubset.tokenField !== "prompt_tokens") {
    changed = rewriteNumberField(record, "prompt_tokens", config.inputTokensRatio) || changed;
  }
  changed = rewriteNumberField(record, "completion_tokens", config.outputTokensRatio) || changed;
  if (!directCachedSubset.tokenField) {
    changed =
      rewriteNumberField(record, "cache_read_input_tokens", config.cacheReadInputTokensRatio) ||
      changed;
  }
  if (!rewroteInputTokenSubset) {
    changed =
      rewriteNestedCachedTokens(record, "input_tokens_details", config.cacheReadInputTokensRatio) ||
      changed;
  }
  if (!rewrotePromptTokenSubset) {
    changed =
      rewriteNestedCachedTokens(
        record,
        "prompt_tokens_details",
        config.cacheReadInputTokensRatio
      ) || changed;
  }
  changed = rewriteClaudeCacheCreation(record, config) || changed;
  changed = rewriteGeminiUsageMetadata(record, config) || changed;
  changed = rewriteOpenAiTotals(record) || changed;

  return changed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function adjustUsageLikeObjectInPlace(
  value: unknown,
  config: StreamUsageAdjustmentConfig,
  options: KeyStreamUsageAdjustmentOptions = {}
): boolean {
  const seen = new WeakSet<object>();

  const visit = (current: unknown): boolean => {
    if (!current || typeof current !== "object" || seen.has(current)) {
      return false;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      return current.reduce((changed, item) => visit(item) || changed, false);
    }

    const record = current as Record<string, unknown>;
    const directChanged = rewriteDirectUsageRecord(record, config, options);
    let childChanged = false;

    for (const [key, child] of Object.entries(record)) {
      if (
        directChanged &&
        (key === "cache_creation" ||
          key === "input_tokens_details" ||
          key === "prompt_tokens_details")
      ) {
        continue;
      }
      if (isRecord(child) || Array.isArray(child)) {
        childChanged = visit(child) || childChanged;
      }
    }

    return directChanged || childChanged;
  };

  return visit(value);
}

function rewriteJsonText(
  text: string,
  config: StreamUsageAdjustmentConfig,
  options: KeyStreamUsageAdjustmentOptions
): string | null {
  try {
    const parsed = JSON.parse(text);
    if (!adjustUsageLikeObjectInPlace(parsed, config, options)) {
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function rewriteStreamLine(
  lineWithEnding: string,
  config: StreamUsageAdjustmentConfig,
  options: KeyStreamUsageAdjustmentOptions
): string {
  const newlineMatch = lineWithEnding.match(/\r?\n$/);
  const newline = newlineMatch?.[0] ?? "";
  const line = newline ? lineWithEnding.slice(0, -newline.length) : lineWithEnding;
  const trimmed = line.trim();

  if (!trimmed) {
    return lineWithEnding;
  }

  const dataPrefixMatch = line.match(/^(data:\s*)(.*)$/);
  if (dataPrefixMatch) {
    const payload = dataPrefixMatch[2]?.trim();
    if (!payload || payload === "[DONE]") {
      return lineWithEnding;
    }
    const rewritten = rewriteJsonText(payload, config, options);
    if (rewritten === null) {
      return lineWithEnding;
    }
    return `${dataPrefixMatch[1]}${rewritten}${newline}`;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const rewritten = rewriteJsonText(trimmed, config, options);
    if (rewritten === null) {
      return lineWithEnding;
    }
    return `${rewritten}${newline}`;
  }

  return lineWithEnding;
}

export function createKeyStreamUsageAdjustmentTransform(
  config: StreamUsageAdjustmentConfig,
  options: KeyStreamUsageAdjustmentOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const drainCompleteLines = (controller: TransformStreamDefaultController<Uint8Array>) => {
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      const line = buffer.slice(0, newlineIndex + 1);
      buffer = buffer.slice(newlineIndex + 1);
      controller.enqueue(encoder.encode(rewriteStreamLine(line, config, options)));
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      drainCompleteLines(controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) {
        controller.enqueue(encoder.encode(rewriteStreamLine(buffer, config, options)));
        buffer = "";
      }
    },
  });
}

export function applyKeyStreamUsageAdjustmentToStream(
  stream: ReadableStream<Uint8Array>,
  decision: KeyStreamUsageAdjustmentDecision | null,
  options: KeyStreamUsageAdjustmentOptions = {}
): ReadableStream<Uint8Array> {
  if (!decision?.hit) {
    return stream;
  }

  logger.debug("[KeyStreamUsageAdjustment] Applying stream usage token rewrite", {
    keyId: decision.audit.keyId,
    probability: decision.config.probability,
    ratios: decision.audit.ratios,
  });

  return stream.pipeThrough(createKeyStreamUsageAdjustmentTransform(decision.config, options));
}
