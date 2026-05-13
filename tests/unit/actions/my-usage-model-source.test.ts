import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => key),
  resolveSystemTimezone: vi.fn(async () => "UTC"),
  findUsageLogsForKeySlim: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

vi.mock("@/drizzle/db", () => ({
  db: {},
}));

vi.mock("@/drizzle/schema", () => ({
  messageRequest: {},
  usageLedger: {},
}));

vi.mock("@/lib/ip-geo/client", () => ({
  lookupIp: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit/concurrent-session-limit", () => ({
  resolveKeyConcurrentSessionLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit/cost-reset-utils", () => ({
  clipStartByResetAt: vi.fn((value: unknown) => value),
  resolveKeyCostResetAt: vi.fn(() => null),
  resolveUser5hCostResetAt: vi.fn(() => null),
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getKeySessionCount: vi.fn(async () => 0),
  },
}));

vi.mock("@/repository/_shared/ledger-conditions", () => ({
  LEDGER_BILLING_CONDITION: {},
}));

vi.mock("@/repository/_shared/message-request-conditions", () => ({
  EXCLUDE_WARMUP_CONDITION: {},
}));

vi.mock("@/repository/usage-logs", () => ({
  findReadonlyUsageLogsBatchForKey: vi.fn(),
  findUsageLogsForKeyBatch: vi.fn(),
  findUsageLogsForKeySlim: mocks.findUsageLogsForKeySlim,
  getDistinctEndpointsForKey: vi.fn(),
  getDistinctModelsForKey: vi.fn(),
}));

const { getMyUsageLogs } = await import("@/actions/my-usage");

describe("my-usage billing model source mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });
  });

  it("falls back to redirected model in getMyUsageLogs when originalModel is missing", async () => {
    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "sk-test" },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    mocks.findUsageLogsForKeySlim.mockResolvedValue({
      logs: [
        {
          id: 1,
          createdAt: new Date("2026-04-26T00:00:00.000Z"),
          model: "claude-sonnet-4-5",
          originalModel: null,
          anthropicEffort: null,
          inputTokens: 1,
          outputTokens: 2,
          costUsd: "0.1",
          statusCode: 200,
          durationMs: 10,
          endpoint: "/v1/messages",
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheTtlApplied: null,
        },
      ],
      total: 1,
    });

    const result = await getMyUsageLogs();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected successful result");
    }
    expect(result.data.logs[0]?.billingModel).toBe("claude-sonnet-4-5");
  });
});
