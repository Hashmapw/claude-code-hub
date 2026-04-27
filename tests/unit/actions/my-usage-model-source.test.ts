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

vi.mock("@/repository/usage-logs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/usage-logs")>();
  return {
    ...actual,
    findUsageLogsForKeySlim: mocks.findUsageLogsForKeySlim,
  };
});

describe("my-usage billing model source mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const { getMyUsageLogs } = await import("@/actions/my-usage");
    const result = await getMyUsageLogs();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected successful result");
    }
    expect(result.data.logs[0]?.billingModel).toBe("claude-sonnet-4-5");
  });
});
