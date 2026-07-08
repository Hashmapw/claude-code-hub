import { beforeEach, describe, expect, it, vi } from "vitest";

const getRedisClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/redis/client", () => ({
  getRedisClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

describe("VIP group usage Redis config", () => {
  beforeEach(() => {
    vi.resetModules();
    getRedisClient.mockReset();
  });

  it("uses enabled defaults when Redis is unavailable or empty", async () => {
    getRedisClient.mockReturnValue(null);

    const { loadVipGroupUsageAlertConfig, DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG } = await import(
      "@/lib/redis/vip-group-usage-config"
    );

    await expect(loadVipGroupUsageAlertConfig()).resolves.toEqual(
      DEFAULT_VIP_GROUP_USAGE_ALERT_CONFIG
    );
  });

  it("normalizes Redis values and clamps cooldown seconds", async () => {
    getRedisClient.mockReturnValue({
      status: "ready",
      hgetall: vi.fn(async () => ({ enabled: "false", cooldownSeconds: "999999" })),
    });

    const { loadVipGroupUsageAlertConfig } = await import("@/lib/redis/vip-group-usage-config");

    await expect(loadVipGroupUsageAlertConfig()).resolves.toEqual({
      enabled: false,
      cooldownSeconds: 86_400,
    });
  });

  it("returns explicit error codes when Redis is unavailable on save", async () => {
    getRedisClient.mockReturnValue(null);

    const { saveVipGroupUsageAlertConfig, VIP_GROUP_USAGE_ALERT_ERROR_CODES } = await import(
      "@/lib/redis/vip-group-usage-config"
    );

    await expect(saveVipGroupUsageAlertConfig({ enabled: false })).resolves.toEqual({
      ok: false,
      errorCode: VIP_GROUP_USAGE_ALERT_ERROR_CODES.REDIS_UNAVAILABLE,
      data: { enabled: false, cooldownSeconds: 300 },
    });
  });

  it("stores runtime config in Redis without DB fields", async () => {
    const redis = {
      status: "ready",
      hgetall: vi.fn(async () => ({ enabled: "1", cooldownSeconds: "300" })),
      hset: vi.fn(async () => 2),
    };
    getRedisClient.mockReturnValue(redis);

    const { saveVipGroupUsageAlertConfig } = await import("@/lib/redis/vip-group-usage-config");

    await expect(
      saveVipGroupUsageAlertConfig({ enabled: false, cooldownSeconds: 0 })
    ).resolves.toEqual({
      ok: true,
      data: { enabled: false, cooldownSeconds: 1 },
    });

    expect(redis.hset).toHaveBeenCalledWith("notification:vip-group-usage:config", {
      enabled: "0",
      cooldownSeconds: "1",
    });
  });
});
