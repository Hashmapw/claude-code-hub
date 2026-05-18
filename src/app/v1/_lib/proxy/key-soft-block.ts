import { getKeySoftBlockConfig } from "@/lib/key-soft-block-store";
import { logger } from "@/lib/logger";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";
import type { SpecialSetting } from "@/types/special-settings";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

async function getRequestLocale(): Promise<string> {
  const { getLocale } = await import("next-intl/server");
  return await getLocale();
}

export async function resolveKeySoftBlockMessage(
  message: string | null | undefined
): Promise<string> {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (normalized) {
    return normalized;
  }

  const locale = await getRequestLocale();
  return await getErrorMessageServer(locale, ERROR_CODES.PROXY_KEY_SOFT_BLOCKED);
}

async function loadRuntimeSoftBlockConfig(session: ProxySession) {
  const keyId = session.authState?.key?.id;
  if (!keyId) {
    return { enabled: false, message: null as string | null };
  }
  return getKeySoftBlockConfig(keyId);
}

export async function handleKeySoftBlock(session: ProxySession): Promise<Response | null> {
  const config = await loadRuntimeSoftBlockConfig(session);
  if (!config.enabled) {
    return null;
  }

  const { SessionManager } = await import("@/lib/session-manager");

  const message = await resolveKeySoftBlockMessage(config.message);

  if (!session.sessionId) {
    session.setSessionId(SessionManager.generateSessionId());
  }

  const setting = createKeySoftBlockSpecialSetting(message);
  session.addSpecialSetting(setting);

  if (session.sessionId) {
    try {
      await SessionManager.storeSessionSpecialSettings(
        session.sessionId,
        session.getSpecialSettings(),
        session.getRequestSequence()
      );
    } catch (error) {
      logger.warn("[KeySoftBlock] Failed to persist guard intercept special setting", {
        userId: session.authState?.user?.id,
        keyId: session.authState?.key?.id,
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn("[KeySoftBlock] Blocked request for soft-blocked key", {
    userId: session.authState?.user?.id,
    keyId: session.authState?.key?.id,
    sessionId: session.sessionId,
  });

  return buildKeySoftBlockResponse(message);
}

export function buildKeySoftBlockResponse(message: string): Response {
  return ProxyResponses.buildError(401, message, "user_disabled");
}

function createKeySoftBlockSpecialSetting(message: string): SpecialSetting {
  return {
    type: "guard_intercept",
    scope: "guard",
    hit: true,
    guard: "key_soft_block",
    action: "block_request",
    statusCode: 401,
    reason: JSON.stringify({ message }),
  };
}
