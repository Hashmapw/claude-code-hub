import { StreamPrefixBlockError } from "@/app/v1/_lib/proxy/errors";
import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { errorRuleDetector } from "@/lib/error-rule-detector";
import { logger } from "@/lib/logger";
import {
  findMatchedStreamPrefixKeyword,
  type ResolvedStreamPrefixBlockRule,
} from "@/lib/stream-prefix-block-rule";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";

type ProxySessionWithStreamPrefixGateRuntime = ProxySession & {
  streamPrefixBlockGateHandled?: boolean;
};

export function hasStreamPrefixBlockGateHandled(session: ProxySession): boolean {
  return (session as ProxySessionWithStreamPrefixGateRuntime).streamPrefixBlockGateHandled === true;
}

export function markStreamPrefixBlockGateHandled(session: ProxySession): void {
  (session as ProxySessionWithStreamPrefixGateRuntime).streamPrefixBlockGateHandled = true;
}

export function buildStreamPrefixBlockProxyResponse(error: StreamPrefixBlockError): Response {
  const statusCode = error.overrideStatusCode ?? error.statusCode;
  if (error.overrideResponse) {
    return new Response(JSON.stringify(error.overrideResponse), {
      status: statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  return ProxyResponses.buildError(statusCode, error.message, "permission_error", {
    reason: "stream_prefix_block",
    ruleId: error.ruleId,
    matchedKeyword: error.matchedKeyword,
  });
}

async function getRequestLocale(): Promise<string> {
  const { getLocale } = await import("next-intl/server");
  return await getLocale();
}

async function resolveStreamPrefixBlockRuntimeRule(
  rule: ResolvedStreamPrefixBlockRule
): Promise<ResolvedStreamPrefixBlockRule> {
  // Manually constructed rules in tests/older callers do not carry this flag.
  // Only rules resolved from the detector with hasExplicitMessage=false should
  // replace the internal message code with a localized default.
  if (rule.hasExplicitMessage !== false) {
    return rule;
  }

  try {
    const locale = await getRequestLocale();
    return {
      ...rule,
      message: await getErrorMessageServer(locale, ERROR_CODES.STREAM_PREFIX_BLOCKED),
    };
  } catch (error) {
    logger.warn("[StreamPrefixBlockGate] Failed to resolve request locale for default message", {
      ruleId: rule.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...rule,
      message: await getErrorMessageServer("en", ERROR_CODES.STREAM_PREFIX_BLOCKED),
    };
  }
}

export async function scanStreamPrefixBlockResponse(options: {
  response: Response;
  providerId: number | null | undefined;
  providerName?: string | null;
  sessionId?: string | null;
  messageRequestId?: number | null;
}): Promise<Response> {
  const { response, providerId, providerName, sessionId, messageRequestId } = options;
  const applicableRules = errorRuleDetector.getStreamPrefixBlockRulesForProvider(providerId);
  if (applicableRules.length === 0 || !response.body) {
    return response;
  }

  const scanLimitBytes = applicableRules.reduce(
    (maxBytes, rule) => Math.max(maxBytes, rule.scanLimitBytes),
    0
  );
  if (scanLimitBytes <= 0) {
    return response;
  }

  const reader = response.body.getReader();
  const bufferedChunks: Uint8Array[] = [];
  let bufferedBytes = 0;
  let streamEndedDuringScan = false;
  let readerReleased = false;
  let upstreamFinished = false;
  let upstreamCancelled = false;
  let downstreamCancelled = false;
  let readerOwnerTransferred = false;

  const releaseReaderOnce = () => {
    if (readerReleased) {
      return;
    }
    readerReleased = true;
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  };

  const cancelReaderOnce = async (reason?: unknown) => {
    if (readerReleased || upstreamFinished || upstreamCancelled) {
      return;
    }
    upstreamCancelled = true;
    try {
      await reader.cancel(reason);
    } catch {
      // ignore
    } finally {
      releaseReaderOnce();
    }
  };

  try {
    while (bufferedBytes < scanLimitBytes) {
      const { done, value } = await reader.read();
      if (done) {
        streamEndedDuringScan = true;
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      bufferedChunks.push(value);
      bufferedBytes += value.byteLength;
    }

    if (bufferedChunks.length === 0 && streamEndedDuringScan) {
      upstreamFinished = true;
      releaseReaderOnce();
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      });
    }

    const buffer = new Uint8Array(bufferedBytes);
    let offset = 0;
    for (const chunk of bufferedChunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const scannedText = new TextDecoder().decode(buffer);
    for (const rule of applicableRules) {
      const matchedKeyword = findMatchedStreamPrefixKeyword(scannedText, rule);
      if (!matchedKeyword) {
        continue;
      }

      logger.warn("[StreamPrefixBlockGate] Stream prefix block rule matched", {
        sessionId: sessionId ?? null,
        providerId,
        providerName: providerName ?? null,
        messageRequestId: messageRequestId ?? null,
        ruleId: rule.id,
        matchedKeyword,
        scanLimitBytes: rule.scanLimitBytes,
      });

      await cancelReaderOnce(`stream_prefix_block:${matchedKeyword}`);

      const runtimeRule = await resolveStreamPrefixBlockRuntimeRule(rule);

      throw new StreamPrefixBlockError({
        rule: runtimeRule,
        matchedKeyword,
        providerId,
        providerName,
      });
    }

    let controllerSettled = false;
    const closeControllerOnce = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (controllerSettled || downstreamCancelled) {
        return;
      }
      controllerSettled = true;
      try {
        controller.close();
      } catch {
        // ignore
      }
    };
    const errorControllerOnce = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      error: unknown
    ) => {
      if (controllerSettled || downstreamCancelled) {
        return;
      }
      controllerSettled = true;
      try {
        controller.error(error);
      } catch {
        // ignore
      }
    };

    const resumedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of bufferedChunks) {
          controller.enqueue(chunk);
        }

        if (streamEndedDuringScan) {
          upstreamFinished = true;
          closeControllerOnce(controller);
          releaseReaderOnce();
          return;
        }

        const pump = async () => {
          try {
            while (!downstreamCancelled) {
              const { done, value } = await reader.read();
              if (done) {
                upstreamFinished = true;
                closeControllerOnce(controller);
                break;
              }
              if (value && value.byteLength > 0 && !downstreamCancelled) {
                controller.enqueue(value);
              }
            }
          } catch (error) {
            errorControllerOnce(controller, error);
          } finally {
            releaseReaderOnce();
          }
        };

        void pump();
      },
      cancel(reason) {
        downstreamCancelled = true;
        return cancelReaderOnce(reason);
      },
    });
    readerOwnerTransferred = true;

    return new Response(resumedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  } catch (error) {
    if (!readerOwnerTransferred) {
      releaseReaderOnce();
    }
    throw error;
  }
}
