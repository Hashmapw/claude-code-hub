import { beforeEach, describe, expect, it, vi } from "vitest";

const getRedisClient = vi.hoisted(() => vi.fn());
const loadVipGroupUsageAlertConfig = vi.hoisted(() => vi.fn());
const getEnabledBindingsByType = vi.hoisted(() => vi.fn());
const addNotificationJobForTarget = vi.hoisted(() => vi.fn());

vi.mock("@/lib/redis/client", () => ({
  getRedisClient,
}));

vi.mock("@/lib/redis/vip-group-usage-config", () => ({
  loadVipGroupUsageAlertConfig,
}));

vi.mock("@/repository/notification-bindings", () => ({
  getEnabledBindingsByType,
}));

vi.mock("@/lib/notification/notification-queue", () => ({
  addNotificationJobForTarget,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const payload = {
  userId: 1,
  userName: "alice",
  providerId: 2,
  providerName: "vip-provider",
  providerGroupTag: "vip",
  model: "claude-sonnet-4-5",
  sessionId: "session-1",
  timestamp: "2026-06-15T00:00:00.000Z",
};

describe("sendVipGroupUsageAlert", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    loadVipGroupUsageAlertConfig.mockResolvedValue({ enabled: true, cooldownSeconds: 300 });
    getEnabledBindingsByType.mockResolvedValue([{ id: 7, targetId: 9 }]);
    addNotificationJobForTarget.mockResolvedValue(undefined);
    getRedisClient.mockReturnValue({
      set: vi.fn(async () => "OK"),
    });
  });

  it("deduplicates by provider and session before enqueueing target jobs", async () => {
    const redis = { set: vi.fn(async () => "OK") };
    getRedisClient.mockReturnValue(redis);

    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");
    await sendVipGroupUsageAlert(payload);

    expect(getEnabledBindingsByType).toHaveBeenCalledWith("vip_group_usage");
    expect(redis.set).toHaveBeenCalledWith(
      "vip-group-usage-alert:2:session-1",
      "1",
      "EX",
      300,
      "NX"
    );
    expect(addNotificationJobForTarget).toHaveBeenCalledWith("vip-group-usage", 9, 7, payload);
  });

  it("skips enqueue when disabled, unbound, or within cooldown", async () => {
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

    loadVipGroupUsageAlertConfig.mockResolvedValueOnce({ enabled: false, cooldownSeconds: 300 });
    await sendVipGroupUsageAlert(payload);
    expect(addNotificationJobForTarget).not.toHaveBeenCalled();

    loadVipGroupUsageAlertConfig.mockResolvedValueOnce({ enabled: true, cooldownSeconds: 300 });
    getEnabledBindingsByType.mockResolvedValueOnce([]);
    await sendVipGroupUsageAlert(payload);
    expect(addNotificationJobForTarget).not.toHaveBeenCalled();

    loadVipGroupUsageAlertConfig.mockResolvedValueOnce({ enabled: true, cooldownSeconds: 300 });
    getEnabledBindingsByType.mockResolvedValueOnce([{ id: 7, targetId: 9 }]);
    getRedisClient.mockReturnValueOnce({ set: vi.fn(async () => null) });
    await sendVipGroupUsageAlert(payload);
    expect(addNotificationJobForTarget).not.toHaveBeenCalled();
  });
});
