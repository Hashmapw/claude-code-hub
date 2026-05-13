import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type SavedEndpointCircuitState = {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: "closed" | "open" | "half-open";
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
};

function cloneSavedState(
  state: SavedEndpointCircuitState | null | undefined
): SavedEndpointCircuitState | null {
  return state
    ? {
        failureCount: state.failureCount,
        lastFailureTime: state.lastFailureTime,
        circuitState: state.circuitState,
        circuitOpenUntil: state.circuitOpenUntil,
        halfOpenSuccessCount: state.halfOpenSuccessCount,
      }
    : null;
}

async function flushPromises(rounds = 2): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForMockCalled(mock: ReturnType<typeof vi.fn>, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (mock.mock.calls.length === 0 && Date.now() - startedAt < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

const mockState = vi.hoisted(() => {
  const envConfig = { ENABLE_ENDPOINT_CIRCUIT_BREAKER: true };
  const persistedStates = new Map<number, SavedEndpointCircuitState>();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  const sendCircuitBreakerAlert = vi.fn();
  const findProviderEndpointById = vi.fn();
  const redisScan = vi.fn();
  const redisDel = vi.fn();
  const loadEndpointCircuitState = vi.fn();
  const loadEndpointCircuitStates = vi.fn();
  const saveEndpointCircuitState = vi.fn();
  const deleteEndpointCircuitState = vi.fn();

  return {
    envConfig,
    persistedStates,
    logger,
    sendCircuitBreakerAlert,
    findProviderEndpointById,
    redisScan,
    redisDel,
    loadEndpointCircuitState,
    loadEndpointCircuitStates,
    saveEndpointCircuitState,
    deleteEndpointCircuitState,
  };
});

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => mockState.envConfig,
}));

vi.mock("@/lib/logger", () => ({
  logger: mockState.logger,
}));

vi.mock("@/lib/notification/notifier", () => ({
  sendCircuitBreakerAlert: mockState.sendCircuitBreakerAlert,
}));

vi.mock("@/repository", () => ({
  findProviderEndpointById: mockState.findProviderEndpointById,
}));

vi.mock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
  loadEndpointCircuitState: mockState.loadEndpointCircuitState,
  loadEndpointCircuitStates: mockState.loadEndpointCircuitStates,
  saveEndpointCircuitState: mockState.saveEndpointCircuitState,
  deleteEndpointCircuitState: mockState.deleteEndpointCircuitState,
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: () => ({
    scan: mockState.redisScan,
    del: mockState.redisDel,
  }),
}));

await import("@/lib/config/env.schema");

const {
  getAllEndpointHealthStatusAsync,
  getEndpointCircuitStateSync,
  getEndpointHealthInfo,
  initEndpointCircuitBreaker,
  isEndpointCircuitOpen,
  recordEndpointFailure,
  recordEndpointSuccess,
  resetEndpointCircuit,
  triggerEndpointCircuitBreakerAlert,
} = await import("@/lib/endpoint-circuit-breaker");

function resetDefaultMockImplementations() {
  mockState.sendCircuitBreakerAlert.mockReset();
  mockState.sendCircuitBreakerAlert.mockResolvedValue(undefined);

  mockState.findProviderEndpointById.mockReset();
  mockState.findProviderEndpointById.mockResolvedValue(null);

  mockState.redisScan.mockReset();
  mockState.redisScan.mockResolvedValue(["0", []]);

  mockState.redisDel.mockReset();
  mockState.redisDel.mockResolvedValue(0);

  mockState.loadEndpointCircuitState.mockReset();
  mockState.loadEndpointCircuitState.mockImplementation(async (endpointId: number) => {
    return cloneSavedState(mockState.persistedStates.get(endpointId) ?? null);
  });

  mockState.loadEndpointCircuitStates.mockReset();
  mockState.loadEndpointCircuitStates.mockImplementation(async (endpointIds: readonly number[]) => {
    const result = new Map<number, SavedEndpointCircuitState>();
    for (const endpointId of endpointIds) {
      const state = cloneSavedState(mockState.persistedStates.get(endpointId) ?? null);
      if (state) {
        result.set(endpointId, state);
      }
    }
    return result;
  });

  mockState.saveEndpointCircuitState.mockReset();
  mockState.saveEndpointCircuitState.mockImplementation(
    async (endpointId: number, state: SavedEndpointCircuitState) => {
      const clonedState = cloneSavedState(state);
      if (clonedState) {
        mockState.persistedStates.set(endpointId, clonedState);
      }
    }
  );

  mockState.deleteEndpointCircuitState.mockReset();
  mockState.deleteEndpointCircuitState.mockImplementation(async (endpointId: number) => {
    mockState.persistedStates.delete(endpointId);
  });

  for (const loggerMock of Object.values(mockState.logger)) {
    loggerMock.mockReset();
  }
}

async function clearEndpointCircuitBreakerMemoryState(): Promise<void> {
  const previousEnabled = mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER;
  mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = false;
  mockState.redisScan.mockResolvedValue(["0", []]);
  mockState.redisDel.mockResolvedValue(0);
  await initEndpointCircuitBreaker();
  mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = previousEnabled;
}

function getPersistedState(endpointId: number): SavedEndpointCircuitState | null {
  return cloneSavedState(mockState.persistedStates.get(endpointId) ?? null);
}

beforeEach(async () => {
  vi.useRealTimers();
  await flushPromises(4);
  await clearEndpointCircuitBreakerMemoryState();
  mockState.persistedStates.clear();
  resetDefaultMockImplementations();
  mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = true;
});

afterEach(async () => {
  vi.useRealTimers();
  await flushPromises(4);
  delete process.env.ENDPOINT_CIRCUIT_HEALTH_CACHE_MAX_SIZE;
});

describe("endpoint-circuit-breaker", () => {
  test("达到阈值后应打开熔断；到期后进入 half-open；成功后关闭并清零", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await recordEndpointFailure(1, new Error("boom"));
    await recordEndpointFailure(1, new Error("boom"));
    await recordEndpointFailure(1, new Error("boom"));

    const openState = getPersistedState(1);
    expect(openState).toMatchObject({
      circuitState: "open",
      failureCount: 3,
      circuitOpenUntil: Date.now() + 300000,
    });

    // 在 fake timers 下，第一次读取 open 状态时先做一次 warm-up，避免动态 import 的首次解析抖动。
    await isEndpointCircuitOpen(1);
    expect(await isEndpointCircuitOpen(1)).toBe(true);

    vi.advanceTimersByTime(300000 + 1);

    expect(await isEndpointCircuitOpen(1)).toBe(false);
    const halfOpenState = getPersistedState(1);
    expect(halfOpenState).toMatchObject({
      circuitState: "half-open",
      halfOpenSuccessCount: 0,
    });

    await recordEndpointSuccess(1);
    expect(mockState.deleteEndpointCircuitState).toHaveBeenCalledWith(1);

    const { health: afterSuccess } = await getEndpointHealthInfo(1);
    expect(afterSuccess).toMatchObject({
      failureCount: 0,
      circuitState: "closed",
      circuitOpenUntil: null,
      lastFailureTime: null,
      halfOpenSuccessCount: 0,
    });

    expect(await isEndpointCircuitOpen(1)).toBe(false);

    const deleteCallsAfterSuccess = mockState.deleteEndpointCircuitState.mock.calls.length;
    await resetEndpointCircuit(1);
    expect(mockState.deleteEndpointCircuitState.mock.calls.length).toBeGreaterThan(
      deleteCallsAfterSuccess
    );

    vi.useRealTimers();
    await waitForMockCalled(mockState.sendCircuitBreakerAlert);
    expect(mockState.sendCircuitBreakerAlert).toHaveBeenCalledTimes(1);
  });

  test("recordEndpointSuccess: closed 且 failureCount>0 时应清零", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await recordEndpointFailure(2, new Error("boom"));
    await recordEndpointSuccess(2);

    const { health } = await getEndpointHealthInfo(2);
    expect(health.failureCount).toBe(0);
    expect(health.circuitState).toBe("closed");

    expect(mockState.saveEndpointCircuitState).toHaveBeenCalledTimes(1);
    expect(mockState.deleteEndpointCircuitState).toHaveBeenCalledWith(2);
  });

  test("getAllEndpointHealthStatusAsync: forceRefresh 时应同步 Redis 中的计数（即使 circuitState 未变化）", async () => {
    const endpointId = 42;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const t0 = Date.now();

    mockState.persistedStates.set(endpointId, {
      failureCount: 1,
      lastFailureTime: t0 - 1000,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    const first = await getAllEndpointHealthStatusAsync([endpointId], { forceRefresh: true });
    expect(first[endpointId]).toMatchObject({
      failureCount: 1,
      lastFailureTime: t0 - 1000,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    mockState.persistedStates.set(endpointId, {
      failureCount: 2,
      lastFailureTime: t0 + 123,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    const second = await getAllEndpointHealthStatusAsync([endpointId], { forceRefresh: true });
    expect(second[endpointId]).toMatchObject({
      failureCount: 2,
      lastFailureTime: t0 + 123,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    expect(mockState.loadEndpointCircuitStates).toHaveBeenCalledTimes(2);
  });

  test("getAllEndpointHealthStatusAsync: 并发请求应复用 in-flight Redis 批量加载", async () => {
    mockState.loadEndpointCircuitStates.mockImplementation(
      async (_endpointIds: readonly number[]) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = new Map<number, SavedEndpointCircuitState>();
        result.set(1, {
          failureCount: 0,
          lastFailureTime: null,
          circuitState: "closed",
          circuitOpenUntil: null,
          halfOpenSuccessCount: 0,
        });
        result.set(2, {
          failureCount: 0,
          lastFailureTime: null,
          circuitState: "closed",
          circuitOpenUntil: null,
          halfOpenSuccessCount: 0,
        });
        result.set(3, {
          failureCount: 0,
          lastFailureTime: null,
          circuitState: "closed",
          circuitOpenUntil: null,
          halfOpenSuccessCount: 0,
        });
        return result;
      }
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const p1 = getAllEndpointHealthStatusAsync([1, 2, 3], { forceRefresh: true });
    const p2 = getAllEndpointHealthStatusAsync([1, 2, 3], { forceRefresh: true });

    vi.advanceTimersByTime(20);
    await Promise.all([p1, p2]);
    expect(mockState.loadEndpointCircuitStates).toHaveBeenCalledTimes(1);
  });

  test("triggerEndpointCircuitBreakerAlert should call sendCircuitBreakerAlert", async () => {
    await triggerEndpointCircuitBreakerAlert(
      5,
      3,
      "2026-01-01T00:05:00.000Z",
      "connection refused"
    );

    const endpoint5Calls = mockState.sendCircuitBreakerAlert.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((payload) => payload.endpointId === 5);
    expect(endpoint5Calls).toHaveLength(1);
    expect(endpoint5Calls[0]).toEqual({
      providerId: 0,
      providerName: "endpoint:5",
      failureCount: 3,
      retryAt: "2026-01-01T00:05:00.000Z",
      lastError: "connection refused",
      incidentSource: "endpoint",
      endpointId: 5,
      endpointUrl: undefined,
    });
  });

  test("triggerEndpointCircuitBreakerAlert should include endpointUrl when available", async () => {
    mockState.findProviderEndpointById.mockResolvedValue({
      id: 10,
      url: "https://custom.example.com/v1/chat/completions",
      vendorId: 1,
      providerType: "openai",
      label: "Custom Endpoint",
      sortOrder: 0,
      isEnabled: true,
      lastProbedAt: null,
      lastProbeOk: null,
      lastProbeStatusCode: null,
      lastProbeLatencyMs: null,
      lastProbeErrorType: null,
      lastProbeErrorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    await triggerEndpointCircuitBreakerAlert(10, 3, "2026-01-01T00:05:00.000Z", "timeout");

    const endpoint10Calls = mockState.sendCircuitBreakerAlert.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((payload) => payload.endpointId === 10);
    expect(endpoint10Calls).toHaveLength(1);
    expect(endpoint10Calls[0]).toEqual({
      providerId: 1,
      providerName: "Custom Endpoint",
      failureCount: 3,
      retryAt: "2026-01-01T00:05:00.000Z",
      lastError: "timeout",
      incidentSource: "endpoint",
      endpointId: 10,
      endpointUrl: "https://custom.example.com/v1/chat/completions",
    });
  });

  test("recordEndpointFailure should NOT reset circuitOpenUntil when already open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await recordEndpointFailure(100, new Error("fail"));
    await recordEndpointFailure(100, new Error("fail"));
    await recordEndpointFailure(100, new Error("fail"));

    const { health: healthSnap } = await getEndpointHealthInfo(100);
    expect(healthSnap.circuitState).toBe("open");

    // 在 fake timers 下，第一次读取 open 状态时先做一次 warm-up，避免动态 import 的首次解析抖动。
    await isEndpointCircuitOpen(100);
    expect(await isEndpointCircuitOpen(100)).toBe(true);
    const originalOpenUntil = getPersistedState(100)?.circuitOpenUntil;
    expect(originalOpenUntil).toBe(Date.now() + 300000);

    vi.advanceTimersByTime(60_000);
    await recordEndpointFailure(100, new Error("fail again"));

    expect(getPersistedState(100)).toMatchObject({
      circuitState: "open",
      circuitOpenUntil: originalOpenUntil,
      failureCount: 4,
    });

    vi.useRealTimers();
    await waitForMockCalled(mockState.sendCircuitBreakerAlert);
    expect(mockState.sendCircuitBreakerAlert).toHaveBeenCalledTimes(1);
  });

  test("getEndpointCircuitStateSync returns correct state for known and unknown endpoints", async () => {
    expect(getEndpointCircuitStateSync(9999)).toBe("closed");

    await recordEndpointFailure(200, new Error("a"));
    await recordEndpointFailure(200, new Error("b"));
    await recordEndpointFailure(200, new Error("c"));
    expect(getEndpointCircuitStateSync(200)).toBe("open");

    vi.useRealTimers();
    await waitForMockCalled(mockState.sendCircuitBreakerAlert);
    expect(mockState.sendCircuitBreakerAlert).toHaveBeenCalledTimes(1);
  });

  describe("ENABLE_ENDPOINT_CIRCUIT_BREAKER disabled", () => {
    test("isEndpointCircuitOpen returns false when ENABLE_ENDPOINT_CIRCUIT_BREAKER=false", async () => {
      mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = false;

      expect(await isEndpointCircuitOpen(1)).toBe(false);
      expect(await isEndpointCircuitOpen(999)).toBe(false);
    });

    test("recordEndpointFailure is no-op when disabled", async () => {
      mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = false;

      await recordEndpointFailure(1, new Error("boom"));
      await recordEndpointFailure(1, new Error("boom"));
      await recordEndpointFailure(1, new Error("boom"));

      expect(mockState.saveEndpointCircuitState).not.toHaveBeenCalled();
    });

    test("recordEndpointSuccess is no-op when disabled", async () => {
      mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = false;

      await recordEndpointSuccess(1);

      expect(mockState.saveEndpointCircuitState).not.toHaveBeenCalled();
    });

    test("triggerEndpointCircuitBreakerAlert is no-op when disabled", async () => {
      mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = false;

      await triggerEndpointCircuitBreakerAlert(
        5,
        3,
        "2026-01-01T00:05:00.000Z",
        "connection refused"
      );

      expect(mockState.sendCircuitBreakerAlert).not.toHaveBeenCalled();
    });

    test("initEndpointCircuitBreaker clears in-memory state and Redis keys when disabled", async () => {
      mockState.redisScan.mockResolvedValueOnce([
        "0",
        ["endpoint_circuit_breaker:state:1", "endpoint_circuit_breaker:state:2"],
      ]);
      mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = false;

      await initEndpointCircuitBreaker();

      expect(mockState.redisScan).toHaveBeenCalled();
      expect(mockState.redisDel).toHaveBeenCalledWith(
        "endpoint_circuit_breaker:state:1",
        "endpoint_circuit_breaker:state:2"
      );
    });

    test("initEndpointCircuitBreaker is no-op when enabled", async () => {
      mockState.envConfig.ENABLE_ENDPOINT_CIRCUIT_BREAKER = true;

      await initEndpointCircuitBreaker();

      expect(mockState.redisScan).not.toHaveBeenCalled();
      expect(mockState.redisDel).not.toHaveBeenCalled();
    });
  });
});
