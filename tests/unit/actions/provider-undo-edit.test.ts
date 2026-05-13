import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editProvider, undoProviderPatch } from "@/actions/providers";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "../../../src/lib/provider-batch-patch-error-codes";

const getSessionMock = vi.hoisted(() => vi.fn());
const findProviderByIdMock = vi.hoisted(() => vi.fn());
const updateProviderMock = vi.hoisted(() => vi.fn());
const updateProvidersBatchMock = vi.hoisted(() => vi.fn());
const publishCacheInvalidationMock = vi.hoisted(() => vi.fn());
const clearProviderStateMock = vi.hoisted(() => vi.fn());
const clearConfigCacheMock = vi.hoisted(() => vi.fn());
const saveProviderCircuitConfigMock = vi.hoisted(() => vi.fn());
const deleteProviderCircuitConfigMock = vi.hoisted(() => vi.fn());
const redisState = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number }>();

  function readValue(key: string): string | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  const mocks = {
    setex: vi.fn(async (key: string, ttlSeconds: number, value: string) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return "OK";
    }),
    get: vi.fn(async (key: string) => readValue(key)),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
    eval: vi.fn(async (_script: string, _numKeys: number, key: string) => {
      const value = readValue(key);
      if (value === null) return null;
      store.delete(key);
      return value;
    }),
  };

  return { store, mocks };
});
const redisStore = redisState.store;
const redisMocks = redisState.mocks;

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  findProviderById: findProviderByIdMock,
  findAllProvidersFresh: vi.fn(),
  updateProvider: updateProviderMock,
  updateProvidersBatch: updateProvidersBatchMock,
  deleteProvidersBatch: vi.fn(),
}));

vi.mock("@/repository", () => ({
  restoreProvidersBatch: vi.fn(),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishCacheInvalidationMock,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  clearProviderState: clearProviderStateMock,
  clearConfigCache: clearConfigCacheMock,
  resetCircuit: vi.fn(),
  getAllHealthStatusAsync: vi.fn(),
}));

vi.mock("@/lib/redis/circuit-breaker-config", () => ({
  saveProviderCircuitConfig: saveProviderCircuitConfigMock,
  deleteProviderCircuitConfig: deleteProviderCircuitConfigMock,
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: () => ({
    status: "ready",
    setex: redisMocks.setex,
    get: redisMocks.get,
    del: redisMocks.del,
    eval: redisMocks.eval,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeProvider(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Provider-${id}`,
    url: "https://api.example.com/v1",
    key: "sk-test",
    providerVendorId: null,
    isEnabled: true,
    weight: 100,
    priority: 1,
    groupPriorities: null,
    costMultiplier: 1.0,
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: null,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 10000,
    requestTimeoutNonStreamingMs: 600000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

describe("Provider Single Edit Undo Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findProviderByIdMock.mockResolvedValue(makeProvider(1, { name: "Before Name", key: "sk-old" }));
    updateProviderMock.mockResolvedValue(makeProvider(1, { name: "After Name", key: "sk-new" }));
    updateProvidersBatchMock.mockResolvedValue(1);
    publishCacheInvalidationMock.mockResolvedValue(undefined);
    clearProviderStateMock.mockReturnValue(undefined);
    clearConfigCacheMock.mockReturnValue(undefined);
    saveProviderCircuitConfigMock.mockResolvedValue(undefined);
    deleteProviderCircuitConfigMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("editProvider should return undoToken and operationId", async () => {
    const result = await editProvider(1, { name: "After Name" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.undoToken).toMatch(/^provider_patch_undo_/);
    expect(result.data.operationId).toMatch(/^provider_patch_apply_/);
    expect(findProviderByIdMock).toHaveBeenCalledWith(1);
    expect(updateProviderMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        name: "After Name",
      })
    );
  });

  it("editProvider should reject when provider is missing before update", async () => {
    findProviderByIdMock.mockResolvedValueOnce(null);
    const result = await editProvider(999, { name: "After Name" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("供应商不存在");
    expect(updateProviderMock).not.toHaveBeenCalled();
  });

  it("editProvider should reject when repository update returns null", async () => {
    updateProviderMock.mockResolvedValueOnce(null);
    const result = await editProvider(1, { name: "After Name" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("供应商不存在");
  });

  it("editProvider should continue when circuit config sync fails", async () => {
    updateProviderMock.mockResolvedValueOnce(
      makeProvider(1, {
        circuitBreakerFailureThreshold: 8,
        circuitBreakerOpenDuration: 1800000,
        circuitBreakerHalfOpenSuccessThreshold: 2,
      })
    );
    saveProviderCircuitConfigMock.mockRejectedValueOnce(new Error("redis down"));

    const result = await editProvider(1, {
      name: "After Name",
      circuit_breaker_failure_threshold: 8,
    });

    expect(result.ok).toBe(true);
    expect(saveProviderCircuitConfigMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        failureThreshold: 8,
      })
    );
    expect(clearConfigCacheMock).not.toHaveBeenCalled();
  });

  it("undoProviderPatch should revert a single edit", async () => {
    const edited = await editProvider(1, { name: "After Name" });
    if (!edited.ok) throw new Error(`Edit should succeed: ${edited.error}`);

    updateProvidersBatchMock.mockClear();
    publishCacheInvalidationMock.mockClear();

    const undone = await undoProviderPatch({
      undoToken: edited.data.undoToken,
      operationId: edited.data.operationId,
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({
        name: "Before Name",
      })
    );
    expect(undone.data.revertedCount).toBe(1);
    expect(publishCacheInvalidationMock).toHaveBeenCalledTimes(1);
  });

  it("undoProviderPatch should not include key field in preimage", async () => {
    findProviderByIdMock.mockResolvedValueOnce(makeProvider(1, { key: "sk-before" }));
    updateProviderMock.mockResolvedValueOnce(makeProvider(1, { key: "sk-after" }));

    const edited = await editProvider(1, { key: "sk-after" });
    if (!edited.ok) throw new Error(`Edit should succeed: ${edited.error}`);

    updateProvidersBatchMock.mockClear();

    const undone = await undoProviderPatch({
      undoToken: edited.data.undoToken,
      operationId: edited.data.operationId,
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    expect(undone.data.revertedCount).toBe(0);
    expect(updateProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderPatch should skip unchanged values in single-edit preimage", async () => {
    findProviderByIdMock.mockResolvedValueOnce(makeProvider(1, { name: "Stable Name" }));
    updateProviderMock.mockResolvedValueOnce(makeProvider(1, { name: "Stable Name" }));

    const edited = await editProvider(1, { name: "Stable Name" });
    if (!edited.ok) throw new Error(`Edit should succeed: ${edited.error}`);

    updateProvidersBatchMock.mockClear();
    publishCacheInvalidationMock.mockClear();

    const undone = await undoProviderPatch({
      undoToken: edited.data.undoToken,
      operationId: edited.data.operationId,
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    expect(undone.data.revertedCount).toBe(0);
    expect(updateProvidersBatchMock).not.toHaveBeenCalled();
    expect(publishCacheInvalidationMock).not.toHaveBeenCalled();
  });

  it("undoProviderPatch should stringify numeric costMultiplier on revert", async () => {
    findProviderByIdMock.mockResolvedValueOnce(makeProvider(1, { costMultiplier: 1.25 }));
    updateProviderMock.mockResolvedValueOnce(makeProvider(1, { costMultiplier: 2.5 }));

    const edited = await editProvider(1, { cost_multiplier: 2.5 });
    if (!edited.ok) throw new Error(`Edit should succeed: ${edited.error}`);

    updateProvidersBatchMock.mockClear();

    const undone = await undoProviderPatch({
      undoToken: edited.data.undoToken,
      operationId: edited.data.operationId,
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ costMultiplier: "1.25" })
    );
  });

  it("undoProviderPatch should expire after patch undo TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T00:00:00.000Z"));

    const edited = await editProvider(1, { name: "After Name" });
    if (!edited.ok) throw new Error(`Edit should succeed: ${edited.error}`);

    vi.advanceTimersByTime(10_001);

    const undone = await undoProviderPatch({
      undoToken: edited.data.undoToken,
      operationId: edited.data.operationId,
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED);
  });

  it("undoProviderPatch should reject mismatched operation id", async () => {
    const edited = await editProvider(1, { name: "After Name" });
    if (!edited.ok) throw new Error(`Edit should succeed: ${edited.error}`);

    const undone = await undoProviderPatch({
      undoToken: edited.data.undoToken,
      operationId: `${edited.data.operationId}-mismatch`,
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_CONFLICT);
    expect(updateProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderPatch should reject invalid payload", async () => {
    const undone = await undoProviderPatch({
      undoToken: "",
      operationId: "provider_patch_apply_x",
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.errorCode).toBeDefined();
    expect(updateProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderPatch should reject non-admin session", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

    const undone = await undoProviderPatch({
      undoToken: "provider_patch_undo_x",
      operationId: "provider_patch_apply_x",
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.error).toBe("无权限执行此操作");
    expect(updateProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("undoProviderPatch should return repository errors when revert update fails", async () => {
    const edited = await editProvider(1, { name: "After Name" });
    if (!edited.ok) throw new Error(`Edit should succeed: ${edited.error}`);

    updateProvidersBatchMock.mockRejectedValueOnce(new Error("undo write failed"));

    const undone = await undoProviderPatch({
      undoToken: edited.data.undoToken,
      operationId: edited.data.operationId,
    });

    expect(undone.ok).toBe(false);
    if (undone.ok) return;

    expect(undone.error).toBe("undo write failed");
  });
});
