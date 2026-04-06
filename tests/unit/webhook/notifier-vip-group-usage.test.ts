import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VipGroupUsageData } from "@/lib/webhook/types";

describe("sendVipGroupUsageAlert", () => {
  const mockRedisSet = vi.fn();
  const mockAddNotificationJobForTarget = vi.fn(async () => {});
  const mockGetEnabledBindingsByType = vi.fn();
  const mockLoadVipGroupUsageAlertConfig = vi.fn();

  const data: VipGroupUsageData = {
    userId: 1,
    userName: "Alice",
    providerId: 99,
    providerName: "VIP Provider",
    providerGroupTag: "vip",
    model: "claude-sonnet-4-20250514",
    sessionId: "sess_xxx",
    timestamp: "2026-02-24T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.resetModules();
    mockRedisSet.mockReset();
    mockAddNotificationJobForTarget.mockReset();
    mockGetEnabledBindingsByType.mockReset();
    mockLoadVipGroupUsageAlertConfig.mockReset();
    mockLoadVipGroupUsageAlertConfig.mockImplementation(async () => ({
      enabled: true,
      cooldownSeconds: 300,
    }));
    mockGetEnabledBindingsByType.mockImplementation(async () => [
      { id: 11, targetId: 22, isEnabled: true, target: { isEnabled: true } },
    ]);

    vi.doMock("@/lib/redis/client", () => ({
      getRedisClient: vi.fn(() => ({
        set: mockRedisSet,
      })),
    }));

    vi.doMock("@/lib/redis/vip-group-usage-config", () => ({
      loadVipGroupUsageAlertConfig: mockLoadVipGroupUsageAlertConfig,
    }));

    vi.doMock("@/repository/notification-bindings", () => ({
      getEnabledBindingsByType: mockGetEnabledBindingsByType,
    }));

    vi.doMock("@/lib/notification/notification-queue", () => ({
      addNotificationJobForTarget: mockAddNotificationJobForTarget,
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends and caches dedup key when provider was not alerted recently", async () => {
    mockRedisSet.mockResolvedValue("OK");
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

    await sendVipGroupUsageAlert(data);

    expect(mockAddNotificationJobForTarget).toHaveBeenCalledWith(
      "vip-group-usage",
      22,
      11,
      expect.objectContaining({ providerId: 99, sessionId: "sess_xxx" })
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      "vip-group-usage-alert:99:sess_xxx",
      "1",
      "EX",
      300,
      "NX"
    );
  });

  it("suppresses alert when same provider and session were alerted within cooldown", async () => {
    mockRedisSet.mockResolvedValue(null);
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

    await sendVipGroupUsageAlert(data);

    expect(mockAddNotificationJobForTarget).not.toHaveBeenCalled();
  });

  it("skips when vip_group_usage switch is disabled", async () => {
    mockLoadVipGroupUsageAlertConfig.mockImplementation(async () => ({
      enabled: false,
      cooldownSeconds: 300,
    }));
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

    await sendVipGroupUsageAlert(data);

    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockAddNotificationJobForTarget).not.toHaveBeenCalled();
  });

  it("skips when there are no enabled bindings", async () => {
    mockRedisSet.mockResolvedValue("OK");
    mockGetEnabledBindingsByType.mockImplementation(async () => []);
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

    await sendVipGroupUsageAlert(data);

    expect(mockGetEnabledBindingsByType).toHaveBeenCalledWith("vip_group_usage");
    expect(mockAddNotificationJobForTarget).not.toHaveBeenCalled();
  });

  it("uses configured cooldown seconds from redis", async () => {
    mockLoadVipGroupUsageAlertConfig.mockImplementation(async () => ({
      enabled: true,
      cooldownSeconds: 42,
    }));
    mockRedisSet.mockResolvedValue("OK");
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

    await sendVipGroupUsageAlert(data);

    expect(mockRedisSet).toHaveBeenCalledWith(
      "vip-group-usage-alert:99:sess_xxx",
      "1",
      "EX",
      42,
      "NX"
    );
  });
});
