import { StreamPrefixBlockError } from "@/app/v1/_lib/proxy/errors";
import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { errorRuleDetector } from "@/lib/error-rule-detector";
import { logger } from "@/lib/logger";
import { findMatchedStreamPrefixKeyword } from "@/lib/stream-prefix-block-rule";

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
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
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

      try {
        await reader.cancel(`stream_prefix_block:${matchedKeyword}`);
      } catch {
        // ignore
      }

      throw new StreamPrefixBlockError({
        rule,
        matchedKeyword,
        providerId,
        providerName,
      });
    }

    const resumedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of bufferedChunks) {
          controller.enqueue(chunk);
        }

        if (streamEndedDuringScan) {
          controller.close();
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
          return;
        }

        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              if (value && value.byteLength > 0) {
                controller.enqueue(value);
              }
            }
          } catch (error) {
            controller.error(error);
          } finally {
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
          }
        };

        void pump();
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return new Response(resumedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  } catch (error) {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    throw error;
  }
}
