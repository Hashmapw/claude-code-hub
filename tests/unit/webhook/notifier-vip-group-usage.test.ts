import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadVipGroupUsageAlertConfig: vi.fn(),
  getRedisClient: vi.fn(),
  getEnabledBindingsByType: vi.fn(),
  addNotificationJobForTarget: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/redis/vip-group-usage-config", () => ({
  loadVipGroupUsageAlertConfig: mocks.loadVipGroupUsageAlertConfig,
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: mocks.getRedisClient,
}));

vi.mock("@/repository/notification-bindings", () => ({
  getEnabledBindingsByType: mocks.getEnabledBindingsByType,
}));

vi.mock("@/lib/notification/notification-queue", () => ({
  addNotificationJobForTarget: mocks.addNotificationJobForTarget,
}));

vi.mock("@/lib/notification/tasks/cost-alert", () => ({
  generateCostAlerts: vi.fn(async () => []),
}));

vi.mock("@/lib/notification/tasks/daily-leaderboard", () => ({
  generateDailyLeaderboard: vi.fn(async () => null),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
  },
}));

describe("sendVipGroupUsageAlert", () => {
  let sendVipGroupUsageAlert: typeof import("@/lib/notification/notifier").sendVipGroupUsageAlert;

  beforeAll(async () => {
    ({ sendVipGroupUsageAlert } = await import("@/lib/notification/notifier"));
  }, 20_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadVipGroupUsageAlertConfig.mockResolvedValue({
      enabled: true,
      cooldownSeconds: 300,
    });
    mocks.getEnabledBindingsByType.mockResolvedValue([
      { id: 11, targetId: 101 },
      { id: 12, targetId: 102 },
    ]);
    mocks.getRedisClient.mockReturnValue({
      set: vi.fn(async () => "OK"),
    });
  });

  it("enqueues one notification per enabled binding when not suppressed", async () => {
    await sendVipGroupUsageAlert({
      userId: 1,
      userName: "Alice",
      providerId: 2,
      providerName: "VIP Provider",
      providerGroupTag: "vip",
      model: "claude-sonnet-4-5",
      sessionId: "sess-1",
      timestamp: "2026-04-26T00:00:00.000Z",
    });

    expect(mocks.getEnabledBindingsByType).toHaveBeenCalledWith("vip_group_usage");
    expect(mocks.addNotificationJobForTarget).toHaveBeenCalledTimes(2);
    expect(mocks.addNotificationJobForTarget).toHaveBeenNthCalledWith(
      1,
      "vip-group-usage",
      101,
      11,
      expect.objectContaining({
        providerGroupTag: "vip",
        sessionId: "sess-1",
      })
    );
  });

  it("skips enqueue when redis cooldown reservation fails", async () => {
    mocks.getRedisClient.mockReturnValue({
      set: vi.fn(async () => null),
    });

    await sendVipGroupUsageAlert({
      userId: 1,
      userName: "Alice",
      providerId: 2,
      providerName: "VIP Provider",
      providerGroupTag: "vip",
      model: "claude-sonnet-4-5",
      sessionId: "sess-1",
      timestamp: "2026-04-26T00:00:00.000Z",
    });

    expect(mocks.addNotificationJobForTarget).not.toHaveBeenCalled();
  });
});
