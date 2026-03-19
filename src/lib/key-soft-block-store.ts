import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";

export interface KeySoftBlockConfig {
  enabled: boolean;
  message: string | null;
}

const PREFIX = "cch:key-soft-block:";

function buildKey(keyId: number): string {
  return `${PREFIX}${keyId}`;
}

function normalizeMessage(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getStore() {
  return getRedisClient({ allowWhenRateLimitDisabled: true });
}

export async function getKeySoftBlockConfig(keyId: number): Promise<KeySoftBlockConfig> {
  const redis = getStore();
  if (!redis || redis.status !== "ready") {
    return { enabled: false, message: null };
  }

  try {
    const raw = await redis.get(buildKey(keyId));
    if (!raw) {
      return { enabled: false, message: null };
    }

    const parsed = JSON.parse(raw) as Partial<KeySoftBlockConfig> | null;
    if (!parsed || typeof parsed !== "object") {
      return { enabled: false, message: null };
    }

    return {
      enabled: parsed.enabled === true,
      message: normalizeMessage(parsed.message),
    };
  } catch (error) {
    logger.error("[KeySoftBlockStore] Failed to read config", {
      keyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { enabled: false, message: null };
  }
}

export async function getKeySoftBlockConfigs(
  keyIds: number[]
): Promise<Map<number, KeySoftBlockConfig>> {
  const result = new Map<number, KeySoftBlockConfig>();
  const uniqueIds = Array.from(new Set(keyIds)).filter(Number.isInteger);
  if (uniqueIds.length === 0) {
    return result;
  }

  const redis = getStore();
  if (!redis || redis.status !== "ready") {
    return result;
  }

  try {
    const values = await redis.mget(...uniqueIds.map(buildKey));
    for (let i = 0; i < uniqueIds.length; i += 1) {
      const raw = values[i];
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as Partial<KeySoftBlockConfig> | null;
        if (!parsed || typeof parsed !== "object") continue;
        result.set(uniqueIds[i], {
          enabled: parsed.enabled === true,
          message: normalizeMessage(parsed.message),
        });
      } catch {
        // ignore individual malformed entries
      }
    }
  } catch (error) {
    logger.error("[KeySoftBlockStore] Failed to batch read config", {
      keyCount: uniqueIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}

export async function setKeySoftBlockConfig(
  keyId: number,
  config: KeySoftBlockConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  const redis = getStore();
  if (!redis || redis.status !== "ready") {
    return { ok: false, error: "Redis 不可用，无法保存软临时限制配置" };
  }

  try {
    await redis.set(
      buildKey(keyId),
      JSON.stringify({
        enabled: config.enabled === true,
        message: normalizeMessage(config.message),
      })
    );
    return { ok: true };
  } catch (error) {
    logger.error("[KeySoftBlockStore] Failed to write config", {
      keyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "保存软临时限制配置失败" };
  }
}
