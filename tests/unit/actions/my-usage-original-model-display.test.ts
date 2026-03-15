import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  resolveSystemTimezone: vi.fn(),
  findUsageLogsForKeySlim: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
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

describe("my-usage original model display", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSession.mockReset();
    mocks.getSystemSettings.mockReset();
    mocks.resolveSystemTimezone.mockReset();
    mocks.findUsageLogsForKeySlim.mockReset();

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "test-key" },
      user: { id: 1 },
    });
    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "redirected",
    });
    mocks.resolveSystemTimezone.mockResolvedValue("UTC");
  });

  it("returns original model for my-usage logs and suppresses redirect display", async () => {
    mocks.findUsageLogsForKeySlim.mockResolvedValue({
      total: 2,
      logs: [
        {
          id: 11,
          createdAt: new Date("2026-03-12T10:00:00.000Z"),
          model: "gemini-3.1-pro-high",
          originalModel: "gemini-3.1-pro-preview",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 100,
          outputTokens: 50,
          costUsd: "0.1234",
          durationMs: 300,
          cacheCreationInputTokens: null,
          cacheReadInputTokens: null,
          cacheCreation5mInputTokens: null,
          cacheCreation1hInputTokens: null,
          cacheTtlApplied: null,
        },
        {
          id: 12,
          createdAt: new Date("2026-03-12T10:01:00.000Z"),
          model: "gpt-5.4",
          originalModel: null,
          endpoint: "/v1/responses",
          statusCode: 200,
          inputTokens: 120,
          outputTokens: 60,
          costUsd: "0.2345",
          durationMs: 320,
          cacheCreationInputTokens: null,
          cacheReadInputTokens: null,
          cacheCreation5mInputTokens: null,
          cacheCreation1hInputTokens: null,
          cacheTtlApplied: null,
        },
      ],
    });

    const { getMyUsageLogs } = await import("@/actions/my-usage");
    const res = await getMyUsageLogs({ page: 1, pageSize: 20 });

    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) {
      throw new Error("expected my-usage logs result");
    }

    expect(res.data.billingModelSource).toBe("original");
    expect(res.data.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 11,
          model: "gemini-3.1-pro-preview",
          billingModel: "gemini-3.1-pro-preview",
          modelRedirect: null,
        }),
        expect.objectContaining({
          id: 12,
          model: "gpt-5.4",
          billingModel: "gpt-5.4",
          modelRedirect: null,
        }),
      ])
    );
  });
});
