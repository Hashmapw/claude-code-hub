import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VipGroupUsageData } from "@/lib/webhook/types";

describe("sendVipGroupUsageAlert", () => {
  const mockRedisGet = vi.fn();
  const mockRedisSet = vi.fn();
  const mockAddNotificationJobForTarget = vi.fn(async () => {});

  beforeEach(() => {
    vi.resetModules();

    vi.doMock("@/lib/redis/client", () => ({
      getRedisClient: vi.fn(() => ({
        get: mockRedisGet,
        set: mockRedisSet,
      })),
    }));

    vi.doMock("@/repository/notifications", () => ({
      getNotificationSettings: vi.fn(async () => ({
        enabled: true,
        vipGroupUsageEnabled: true,
      })),
    }));

    vi.doMock("@/repository/notification-bindings", () => ({
      getEnabledBindingsByType: vi.fn(async () => [
        { id: 11, targetId: 22, isEnabled: true, target: { isEnabled: true } },
      ]),
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
    mockRedisGet.mockResolvedValue(null);
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

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

    await sendVipGroupUsageAlert(data);

    expect(mockAddNotificationJobForTarget).toHaveBeenCalledWith(
      "vip-group-usage",
      22,
      11,
      expect.objectContaining({ providerId: 99 })
    );
    expect(mockRedisSet).toHaveBeenCalledWith("vip-group-usage-alert:99", "1", "EX", 300);
  });

  it("suppresses alert when provider was alerted within 5 minutes", async () => {
    mockRedisGet.mockResolvedValue("1");
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");

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

    await sendVipGroupUsageAlert(data);

    expect(mockAddNotificationJobForTarget).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});
