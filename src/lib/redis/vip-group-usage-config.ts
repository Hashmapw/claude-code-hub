import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export interface VipGroupUsageAlertConfig {
  enabled: boolean;
  cooldownSeconds: number;
}

export const VIP_GROUP_USAGE_CONFIG_ERROR_CODES = {
  REDIS_UNAVAILABLE: "VIP_GROUP_USAGE_CONFIG_REDIS_UNAVAILABLE",
  SAVE_FAILED: "VIP_GROUP_USAGE_CONFIG_SAVE_FAILED",
} as const;

export type VipGroupUsageConfigErrorCode =
  (typeof VIP_GROUP_USAGE_CONFIG_ERROR_CODES)[keyof typeof VIP_GROUP_USAGE_CONFIG_ERROR_CODES];

export type SaveVipGroupUsageAlertConfigResult =
  | { ok: true; data: VipGroupUsageAlertConfig }
  | { ok: false; errorCode: VipGroupUsageConfigErrorCode };

export const DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG: VipGroupUsageAlertConfig = {
  enabled: true,
  cooldownSeconds: 300,
};

const VIP_GROUP_USAGE_ALERT_CONFIG_KEY = "notification:vip-group-usage:config";

function normalizeCooldownSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG.cooldownSeconds;
  }
  const intValue = Math.trunc(parsed);
  return Math.min(86400, Math.max(1, intValue));
}

function normalizeEnabled(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "off") {
      return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "on") {
      return true;
    }
  }
  return DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG.enabled;
}

export async function loadVipGroupUsageAlertConfig(): Promise<VipGroupUsageAlertConfig> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });

  if (!redis) {
    return DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG;
  }

  try {
    const cached = await redis.hgetall(VIP_GROUP_USAGE_ALERT_CONFIG_KEY);
    if (!cached || Object.keys(cached).length === 0) {
      return DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG;
    }

    return {
      enabled: normalizeEnabled(cached.enabled),
      cooldownSeconds: normalizeCooldownSeconds(cached.cooldownSeconds),
    };
  } catch (error) {
    logger.warn("[VipGroupUsageConfig] Failed to load config from Redis, using defaults", {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG;
  }
}

export async function saveVipGroupUsageAlertConfig(
  patch: Partial<VipGroupUsageAlertConfig>
): Promise<SaveVipGroupUsageAlertConfigResult> {
  const current = await loadVipGroupUsageAlertConfig();
  const next: VipGroupUsageAlertConfig = {
    enabled: patch.enabled === undefined ? current.enabled : normalizeEnabled(patch.enabled),
    cooldownSeconds:
      patch.cooldownSeconds === undefined
        ? current.cooldownSeconds
        : normalizeCooldownSeconds(patch.cooldownSeconds),
  };

  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis) {
    return { ok: false, errorCode: VIP_GROUP_USAGE_CONFIG_ERROR_CODES.REDIS_UNAVAILABLE };
  }

  try {
    await redis.hset(VIP_GROUP_USAGE_ALERT_CONFIG_KEY, {
      enabled: next.enabled ? "1" : "0",
      cooldownSeconds: String(next.cooldownSeconds),
    });
  } catch (error) {
    logger.warn("[VipGroupUsageConfig] Failed to save config to Redis", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, errorCode: VIP_GROUP_USAGE_CONFIG_ERROR_CODES.SAVE_FAILED };
  }

  return { ok: true, data: next };
}
