import { getKeySoftBlockConfig } from "@/lib/key-soft-block-store";
import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";
import type { SpecialSetting } from "@/types/special-settings";
import { ProxyResponses } from "./responses";
import type { ProxySession } from "./session";

const DEFAULT_SOFT_BLOCK_MESSAGE = "该密钥已被临时限制使用。请联系管理员。";

export function resolveKeySoftBlockMessage(message: string | null | undefined): string {
  const normalized = typeof message === "string" ? message.trim() : "";
  const messageValue = normalized;
  return messageValue || DEFAULT_SOFT_BLOCK_MESSAGE;
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

  const message = resolveKeySoftBlockMessage(config.message);

  if (!session.sessionId) {
    session.setSessionId(SessionManager.generateSessionId());
  }

  const setting = createKeySoftBlockSpecialSetting(message);
  session.addSpecialSetting(setting);

  if (session.sessionId) {
    await SessionManager.storeSessionSpecialSettings(
      session.sessionId,
      session.getSpecialSettings(),
      session.getRequestSequence()
    );
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
