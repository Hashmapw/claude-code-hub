import { describe, expect, it } from "vitest";
import { buildCircuitBreakerMessage } from "@/lib/webhook/templates/circuit-breaker";
import { buildCostAlertMessage } from "@/lib/webhook/templates/cost-alert";
import { buildDailyLeaderboardMessage } from "@/lib/webhook/templates/daily-leaderboard";
import { buildVipGroupUsageMessage } from "@/lib/webhook/templates/vip-group-usage";
import type {
  CircuitBreakerAlertData,
  CostAlertData,
  DailyLeaderboardData,
  VipGroupUsageData,
} from "@/lib/webhook/types";

describe("Message Templates", () => {
  describe("buildCircuitBreakerMessage", () => {
    it("should create structured message for circuit breaker alert", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        lastError: "Connection timeout",
      };

      const message = buildCircuitBreakerMessage(data);

      expect(message.header.level).toBe("error");
      expect(message.header.icon).toBe("🔌");
      expect(message.header.title).toContain("熔断");
      expect(message.timestamp).toBeInstanceOf(Date);

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("OpenAI");
      expect(sectionsStr).toContain("5");
    });

    it("should handle missing lastError", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "Anthropic",
        providerId: 2,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
      };

      const message = buildCircuitBreakerMessage(data);
      expect(message.header.level).toBe("error");
    });

    it("should default to provider source when incidentSource is not set", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
      };

      const message = buildCircuitBreakerMessage(data);
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("OpenAI");
      // Default should use provider-style title
      expect(message.header.title).toMatch(/供应商/);
    });

    it("should produce provider-specific message when incidentSource is provider", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "Anthropic",
        providerId: 2,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "provider",
      };

      const message = buildCircuitBreakerMessage(data);
      expect(message.header.title).toMatch(/供应商/);
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("Anthropic");
      expect(sectionsStr).toContain("ID: 2");
    });

    it("should produce endpoint-specific message when incidentSource is endpoint", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 3,
        retryAt: "2025-01-02T13:00:00Z",
        incidentSource: "endpoint",
        endpointId: 42,
        endpointUrl: "https://api.openai.com/v1",
      };

      const message = buildCircuitBreakerMessage(data);
      expect(message.header.title).toMatch(/端点/);
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("42");
      expect(sectionsStr).toContain("https://api.openai.com/v1");
    });

    it("should include endpoint fields in details when source is endpoint", () => {
      const data: CircuitBreakerAlertData = {
        providerName: "OpenAI",
        providerId: 1,
        failureCount: 5,
        retryAt: "2025-01-02T12:30:00Z",
        lastError: "Connection refused",
        incidentSource: "endpoint",
        endpointId: 99,
        endpointUrl: "https://custom-proxy.example.com/v1",
      };

      const message = buildCircuitBreakerMessage(data);
      const sectionsStr = JSON.stringify(message.sections);
      // Should still include failure count and error
      expect(sectionsStr).toContain("5");
      expect(sectionsStr).toContain("Connection refused");
      // Should include endpoint-specific info
      expect(sectionsStr).toContain("99");
      expect(sectionsStr).toContain("https://custom-proxy.example.com/v1");
    });
  });

  describe("buildCostAlertMessage", () => {
    it("should create structured message for user cost alert", () => {
      const data: CostAlertData = {
        targetType: "user",
        targetName: "张三",
        targetId: 100,
        currentCost: 8.5,
        quotaLimit: 10,
        threshold: 0.8,
        period: "本周",
      };

      const message = buildCostAlertMessage(data);

      expect(message.header.level).toBe("warning");
      expect(message.header.icon).toBe("💰");
      expect(message.header.title).toContain("成本预警");

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("张三");
      expect(sectionsStr).toContain("8.5");
      expect(sectionsStr).toContain("本周");
    });

    it("should create structured message for provider cost alert", () => {
      const data: CostAlertData = {
        targetType: "provider",
        targetName: "GPT-4",
        targetId: 1,
        currentCost: 950,
        quotaLimit: 1000,
        threshold: 0.9,
        period: "本月",
      };

      const message = buildCostAlertMessage(data);

      expect(message.header.level).toBe("warning");
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("供应商");
    });
  });

  describe("buildDailyLeaderboardMessage", () => {
    it("should create structured message for leaderboard", () => {
      const data: DailyLeaderboardData = {
        date: "2025-01-02",
        entries: [
          { userId: 1, userName: "用户A", totalRequests: 100, totalCost: 5.0, totalTokens: 50000 },
          { userId: 2, userName: "用户B", totalRequests: 80, totalCost: 4.0, totalTokens: 40000 },
        ],
        totalRequests: 180,
        totalCost: 9.0,
      };

      const message = buildDailyLeaderboardMessage(data);

      expect(message.header.level).toBe("info");
      expect(message.header.icon).toBe("📊");
      expect(message.header.title).toContain("排行榜");

      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("用户A");
      expect(sectionsStr).toContain("🥇");
    });

    it("should handle empty entries", () => {
      const data: DailyLeaderboardData = {
        date: "2025-01-02",
        entries: [],
        totalRequests: 0,
        totalCost: 0,
      };

      const message = buildDailyLeaderboardMessage(data);

      expect(message.header.level).toBe("info");
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("暂无数据");
    });
  });

  describe("buildVipGroupUsageMessage", () => {
    it("should create structured message for vip group usage alert", () => {
      const data: VipGroupUsageData = {
        userId: 7,
        userName: "测试用户",
        providerId: 11,
        providerName: "VIP线路",
        providerGroupTag: "vip,p0",
        model: "claude-sonnet-4-20250514",
        sessionId: "sess_abc123",
        timestamp: "2025-01-02T12:00:00Z",
      };

      const message = buildVipGroupUsageMessage(data, "UTC");

      expect(message.header.level).toBe("warning");
      expect(message.header.title).toContain("高成本分组使用提醒");
      const sectionsStr = JSON.stringify(message.sections);
      expect(sectionsStr).toContain("测试用户");
      expect(sectionsStr).toContain("VIP线路");
      expect(sectionsStr).toContain("sess_abc123");
    });
  });
});
