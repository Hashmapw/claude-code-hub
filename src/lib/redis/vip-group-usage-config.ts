import { logger } from "@/lib/logger";
import { getRedisClient } from "./client";

export interface VipGroupUsageAlertConfig {
  enabled: boolean;
  cooldownSeconds: number;
}

export const DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG: VipGroupUsageAlertConfig = {
  enabled: true,
  cooldownSeconds: 300,
};

export const VIP_GROUP_USAGE_ALERT_ERROR_CODES = {
  REDIS_UNAVAILABLE: "VIP_GROUP_USAGE_CONFIG_REDIS_UNAVAILABLE",
  SAVE_FAILED: "VIP_GROUP_USAGE_CONFIG_SAVE_FAILED",
} as const;

export type VipGroupUsageAlertErrorCode =
  (typeof VIP_GROUP_USAGE_ALERT_ERROR_CODES)[keyof typeof VIP_GROUP_USAGE_ALERT_ERROR_CODES];

const VIP_GROUP_USAGE_ALERT_CONFIG_KEY = "notification:vip-group-usage:config";

function normalizeCooldownSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG.cooldownSeconds;
  }
  const intValue = Math.trunc(parsed);
  return Math.min(86_400, Math.max(1, intValue));
}

function normalizeEnabled(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "on", "yes", "enabled"].includes(normalized)) {
      return true;
    }
  }
  return DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG.enabled;
}

function getStore() {
  return getRedisClient({ allowWhenRateLimitDisabled: true });
}

export async function loadVipGroupUsageAlertConfig(): Promise<VipGroupUsageAlertConfig> {
  const redis = getStore();

  if (!redis || redis.status !== "ready") {
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
): Promise<
  | { ok: true; data: VipGroupUsageAlertConfig }
  | { ok: false; errorCode: VipGroupUsageAlertErrorCode; data: VipGroupUsageAlertConfig }
> {
  const current = await loadVipGroupUsageAlertConfig();
  const next: VipGroupUsageAlertConfig = {
    enabled: patch.enabled === undefined ? current.enabled : normalizeEnabled(patch.enabled),
    cooldownSeconds:
      patch.cooldownSeconds === undefined
        ? current.cooldownSeconds
        : normalizeCooldownSeconds(patch.cooldownSeconds),
  };

  const redis = getStore();
  if (!redis || redis.status !== "ready") {
    return {
      ok: false,
      errorCode: VIP_GROUP_USAGE_ALERT_ERROR_CODES.REDIS_UNAVAILABLE,
      data: next,
    };
  }

  try {
    await redis.hset(VIP_GROUP_USAGE_ALERT_CONFIG_KEY, {
      enabled: next.enabled ? "1" : "0",
      cooldownSeconds: String(next.cooldownSeconds),
    });
    return { ok: true, data: next };
  } catch (error) {
    logger.warn("[VipGroupUsageConfig] Failed to save config to Redis", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, errorCode: VIP_GROUP_USAGE_ALERT_ERROR_CODES.SAVE_FAILED, data: next };
  }
}
