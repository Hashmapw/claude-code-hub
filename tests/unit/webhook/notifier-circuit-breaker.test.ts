import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CircuitBreakerAlertData } from "@/lib/webhook/types";

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  getNotificationSettings: vi.fn(),
  addNotificationJob: vi.fn(async () => {}),
  addNotificationJobForTarget: vi.fn(async () => {}),
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn(() => ({
    get: mocks.redisGet,
    set: mocks.redisSet,
  })),
}));

vi.mock("@/repository/notifications", () => ({
  getNotificationSettings: mocks.getNotificationSettings,
}));

vi.mock("@/lib/notification/notification-queue", () => ({
  addNotificationJob: mocks.addNotificationJob,
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
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe("sendCircuitBreakerAlert", () => {
  let sendCircuitBreakerAlert: typeof import("@/lib/notification/notifier").sendCircuitBreakerAlert;

  beforeAll(async () => {
    ({ sendCircuitBreakerAlert } = await import("@/lib/notification/notifier"));
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNotificationSettings.mockResolvedValue({
      enabled: true,
      circuitBreakerEnabled: true,
      useLegacyMode: true,
      circuitBreakerWebhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
    });
  });

  describe("dedup key with incidentSource", () => {
    it("should use provider dedup key when incidentSource is provider", async () => {
      mocks.redisGet.mockResolvedValue(null);

      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        incidentSource: "provider",
      };

      await sendCircuitBreakerAlert(data);

      expect(mocks.redisSet).toHaveBeenCalledWith(
        "circuit-breaker-alert:1:provider",
        "1",
        "EX",
        300
      );
    });

    it("should use endpoint dedup key when incidentSource is endpoint", async () => {
      mocks.redisGet.mockResolvedValue(null);

      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
        endpointUrl: "https://api.openai.com/v1",
      };

      await sendCircuitBreakerAlert(data);

      expect(mocks.redisSet).toHaveBeenCalledWith(
        "circuit-breaker-alert:1:endpoint:42",
        "1",
        "EX",
        300
      );
    });

    it("should dedup independently for same provider with different sources", async () => {
      mocks.redisGet.mockResolvedValueOnce("1");
      mocks.redisGet.mockResolvedValueOnce(null);

      const providerData: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        incidentSource: "provider",
      };

      const endpointData: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
        endpointUrl: "https://api.openai.com/v1",
      };

      await sendCircuitBreakerAlert(providerData);
      await sendCircuitBreakerAlert(endpointData);

      expect(mocks.redisSet).toHaveBeenCalledTimes(1);
      expect(mocks.redisSet).toHaveBeenCalledWith(
        "circuit-breaker-alert:1:endpoint:42",
        "1",
        "EX",
        300
      );
    });

    it("should default to provider source when incidentSource is undefined", async () => {
      mocks.redisGet.mockResolvedValue(null);

      const data: CircuitBreakerAlertData = {
        providerName: "Anthropic",
        providerId: 2,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
      };

      await sendCircuitBreakerAlert(data);

      expect(mocks.redisSet).toHaveBeenCalledWith(
        "circuit-breaker-alert:2:provider",
        "1",
        "EX",
        300
      );
    });

    it("should suppress endpoint alert when same endpointId was recently alerted", async () => {
      mocks.redisGet.mockResolvedValueOnce(null);
      mocks.redisGet.mockResolvedValueOnce("1");

      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
      };

      await sendCircuitBreakerAlert(data);
      await sendCircuitBreakerAlert(data);

      expect(mocks.redisSet).toHaveBeenCalledTimes(1);
      expect(mocks.redisGet).toHaveBeenCalledTimes(2);
    });
  });
});
