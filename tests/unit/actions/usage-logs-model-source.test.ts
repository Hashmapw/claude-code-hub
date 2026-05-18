import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getCachedSystemSettingsMock = vi.fn();
const getUsedModelsMock = vi.fn();
const getUsedStatusCodesMock = vi.fn();
const getUsedEndpointsMock = vi.fn();
const findUsageLogsWithDetailsMock = vi.fn();
const findUsageLogsBatchMock = vi.fn();
const findUsageLogsStatsMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: getCachedSystemSettingsMock,
}));

vi.mock("@/repository/usage-logs", () => ({
  findUsageLogSessionIdSuggestions: vi.fn(async () => []),
  findUsageLogsBatch: findUsageLogsBatchMock,
  findUsageLogsStats: findUsageLogsStatsMock,
  findUsageLogsWithDetails: findUsageLogsWithDetailsMock,
  getUsedEndpoints: getUsedEndpointsMock,
  getUsedModels: getUsedModelsMock,
  getUsedStatusCodes: getUsedStatusCodesMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/lib/redis/redis-kv-store", () => ({
  RedisKVStore: class MockRedisKVStore<T> {
    async set(_key: string, _value: T) {
      return true;
    }

    async get(_key: string) {
      return null;
    }

    async getAndDelete(_key: string) {
      return null;
    }

    async delete(_key: string) {
      return true;
    }
  },
}));

function createSummary(totalRequests = 0) {
  return {
    totalRequests,
    totalCost: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreation5mTokens: 0,
    totalCacheCreation1hTokens: 0,
  };
}

function createLog(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date("2026-03-16T00:00:00.000Z"),
    userName: "u",
    keyName: "k",
    providerName: "p",
    model: "redirected-model",
    originalModel: "original-model",
    endpoint: "/v1/messages",
    statusCode: 200,
    inputTokens: 1,
    outputTokens: 2,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 3,
    costUsd: "0",
    durationMs: 10,
    sessionId: "sess-1",
    providerChain: null,
    ...overrides,
  };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (!char) continue;

    if (inQuotes) {
      if (char === '"') {
        const next = line[i + 1];
        if (next === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      current += char;
      continue;
    }

    if (char === ",") {
      fields.push(current);
      current = "";
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

describe("usage logs model source actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    getCachedSystemSettingsMock.mockResolvedValue({ billingModelSource: "original" });
    getUsedModelsMock.mockResolvedValue(["original-model"]);
    getUsedStatusCodesMock.mockResolvedValue([200]);
    getUsedEndpointsMock.mockResolvedValue(["/v1/messages"]);
    findUsageLogsWithDetailsMock.mockResolvedValue({
      logs: [],
      total: 1,
      summary: createSummary(1),
    });
    findUsageLogsBatchMock.mockResolvedValue({
      logs: [createLog()],
      nextCursor: null,
      hasMore: false,
    });
    findUsageLogsStatsMock.mockResolvedValue(createSummary(1));
  });

  it("passes billingModelSource to getUsedModels for model list and filter options", async () => {
    const { getFilterOptions, getModelList } = await import("@/actions/usage-logs");

    const modelList = await getModelList();
    expect(modelList.ok).toBe(true);
    expect(getUsedModelsMock).toHaveBeenCalledWith("original");

    getUsedModelsMock.mockClear();
    const filterOptions = await getFilterOptions();
    expect(filterOptions.ok).toBe(true);
    expect(getUsedModelsMock).toHaveBeenCalledWith("original");
  });

  it("exports CSV with originalModel in the Model column when billingModelSource is original", async () => {
    const { exportUsageLogs } = await import("@/actions/usage-logs");
    const result = await exportUsageLogs({});

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected successful export");
    }

    const csvNoBom = result.data.replace(/^\uFEFF/, "");
    const lines = csvNoBom
      .trim()
      .split("\n")
      .map((line) => line.replace(/\r$/, ""));
    const header = parseCsvLine(lines[0] ?? "");
    const row = parseCsvLine(lines[1] ?? "");

    const modelIndex = header.indexOf("Model");
    const originalModelIndex = header.indexOf("Original Model");

    expect(row[modelIndex]).toBe("original-model");
    expect(row[originalModelIndex]).toBe("original-model");
  });
});
