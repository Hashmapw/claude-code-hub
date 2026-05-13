import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderEndpoint } from "@/types/provider";

const probeMockState = vi.hoisted(() => ({
  envConfig: {
    ENABLE_ENDPOINT_CIRCUIT_BREAKER: true,
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  findProviderEndpointById: vi.fn(),
  recordProviderEndpointProbeResult: vi.fn(),
  updateProviderEndpointProbeSnapshot: vi.fn(),
  getEndpointCircuitStateSync: vi.fn(),
  resetEndpointCircuit: vi.fn(),
  recordEndpointFailure: vi.fn(),
  createConnection: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: probeMockState.logger,
}));

vi.mock("@/repository", () => ({
  findProviderEndpointById: probeMockState.findProviderEndpointById,
  recordProviderEndpointProbeResult: probeMockState.recordProviderEndpointProbeResult,
  updateProviderEndpointProbeSnapshot: probeMockState.updateProviderEndpointProbeSnapshot,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  getEndpointCircuitStateSync: probeMockState.getEndpointCircuitStateSync,
  resetEndpointCircuit: probeMockState.resetEndpointCircuit,
  recordEndpointFailure: probeMockState.recordEndpointFailure,
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => probeMockState.envConfig,
}));

vi.mock("node:net", () => ({
  default: {
    createConnection: probeMockState.createConnection,
  },
}));

const { probeEndpointUrl, probeProviderEndpointAndRecord } = await import(
  "@/lib/provider-endpoints/probe"
);

function makeEndpoint(overrides: Partial<ProviderEndpoint>): ProviderEndpoint {
  return {
    id: 1,
    vendorId: 1,
    providerType: "claude",
    url: "https://example.com",
    label: null,
    sortOrder: 0,
    isEnabled: true,
    lastProbedAt: null,
    lastProbeOk: null,
    lastProbeStatusCode: null,
    lastProbeLatencyMs: null,
    lastProbeErrorType: null,
    lastProbeErrorMessage: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function resetProbeMocks() {
  vi.clearAllMocks();

  probeMockState.envConfig = {
    ENABLE_ENDPOINT_CIRCUIT_BREAKER: true,
  };

  for (const fn of Object.values(probeMockState.logger)) {
    fn.mockReset();
  }

  probeMockState.findProviderEndpointById.mockReset().mockResolvedValue(null);
  probeMockState.recordProviderEndpointProbeResult.mockReset().mockResolvedValue(undefined);
  probeMockState.updateProviderEndpointProbeSnapshot.mockReset().mockResolvedValue(undefined);
  probeMockState.getEndpointCircuitStateSync.mockReset().mockReturnValue("closed");
  probeMockState.resetEndpointCircuit.mockReset().mockResolvedValue(undefined);
  probeMockState.recordEndpointFailure.mockReset().mockResolvedValue(undefined);
  probeMockState.createConnection.mockReset().mockImplementation(() => {
    throw new Error("unexpected net.createConnection call");
  });
}

beforeEach(() => {
  resetProbeMocks();
  delete process.env.ENDPOINT_PROBE_METHOD;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.ENDPOINT_PROBE_METHOD;
});

describe("provider-endpoints: probe", () => {
  test("probeEndpointUrl: HEAD 成功时直接返回，不触发 GET", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";

    const fetchMock = stubFetch(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, { status: 204 });
      }
      throw new Error("unexpected");
    });

    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result).toEqual(
      expect.objectContaining({ ok: true, method: "HEAD", statusCode: 204, errorType: null })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("probeEndpointUrl: HEAD 网络错误时回退 GET", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";

    const fetchMock = stubFetch(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        throw new Error("boom");
      }
      if (init?.method === "GET") {
        return new Response(null, { status: 200 });
      }
      throw new Error("unexpected");
    });

    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result).toEqual(
      expect.objectContaining({ ok: true, method: "GET", statusCode: 200, errorType: null })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("probeEndpointUrl: 5xx 返回 ok=false 且标注 http_5xx", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";

    stubFetch(async () => new Response(null, { status: 503 }));

    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result.ok).toBe(false);
    expect(result.method).toBe("HEAD");
    expect(result.statusCode).toBe(503);
    expect(result.errorType).toBe("http_5xx");
    expect(result.errorMessage).toBe("HTTP 503");
  });

  test("probeEndpointUrl: 4xx 仍视为 ok=true", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";

    stubFetch(async () => new Response(null, { status: 404 }));

    const result = await probeEndpointUrl("https://example.com", 1234);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(404);
    expect(result.errorType).toBeNull();
  });

  test("probeEndpointUrl: AbortError 归类为 timeout", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";

    stubFetch(async () => {
      const err = new Error("");
      err.name = "AbortError";
      throw err;
    });

    const result = await probeEndpointUrl("https://example.com", 1);

    expect(result.ok).toBe(false);
    expect(result.method).toBe("GET");
    expect(result.statusCode).toBeNull();
    expect(result.errorType).toBe("timeout");
    expect(result.errorMessage).toBe("timeout");
  });

  test("probeProviderEndpointAndRecord: endpoint 不存在时返回 null", async () => {
    stubFetch(async () => new Response(null, { status: 200 }));

    const result = await probeProviderEndpointAndRecord({ endpointId: 123, source: "manual" });

    expect(result).toBeNull();
    expect(probeMockState.recordProviderEndpointProbeResult).not.toHaveBeenCalled();
    expect(probeMockState.updateProviderEndpointProbeSnapshot).not.toHaveBeenCalled();
    expect(probeMockState.recordEndpointFailure).not.toHaveBeenCalled();
  });

  test("probeProviderEndpointAndRecord: 记录入库字段包含 source/ok/statusCode/latency/probedAt", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    probeMockState.findProviderEndpointById.mockResolvedValue(
      makeEndpoint({ id: 123, url: "https://example.com" })
    );

    stubFetch(async () => new Response(null, { status: 200 }));

    const result = await probeProviderEndpointAndRecord({
      endpointId: 123,
      source: "manual",
      timeoutMs: 1111,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, statusCode: 200, errorType: null }));

    expect(probeMockState.recordProviderEndpointProbeResult).toHaveBeenCalledTimes(1);
    const payload = probeMockState.recordProviderEndpointProbeResult.mock.calls[0]?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        endpointId: 123,
        source: "manual",
        ok: true,
        statusCode: 200,
        errorType: null,
        errorMessage: null,
      })
    );

    const probedAt = (payload as { probedAt: Date }).probedAt;
    expect(probedAt).toBeInstanceOf(Date);
    expect(probedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    expect(probeMockState.updateProviderEndpointProbeSnapshot).not.toHaveBeenCalled();
    expect(probeMockState.recordEndpointFailure).not.toHaveBeenCalled();
  });

  test("probeProviderEndpointAndRecord: scheduled 成功总是写入探测日志记录", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));

    const endpoint = makeEndpoint({
      id: 1,
      url: "https://example.com",
      lastProbeOk: true,
      lastProbedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    probeMockState.findProviderEndpointById.mockResolvedValue(endpoint);

    stubFetch(async () => new Response(null, { status: 200 }));

    const result = await probeProviderEndpointAndRecord({ endpointId: 1, source: "scheduled" });

    expect(result).toEqual(expect.objectContaining({ ok: true, statusCode: 200 }));
    expect(probeMockState.recordProviderEndpointProbeResult).toHaveBeenCalledTimes(1);
    expect(probeMockState.recordEndpointFailure).not.toHaveBeenCalled();
  });

  test("probeProviderEndpointAndRecord: 失败会计入端点熔断计数（scheduled 与 manual）", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "HEAD";

    probeMockState.findProviderEndpointById.mockResolvedValue(
      makeEndpoint({ id: 123, url: "https://example.com" })
    );

    stubFetch(async () => new Response(null, { status: 503 }));

    await probeProviderEndpointAndRecord({ endpointId: 123, source: "scheduled" });
    await probeProviderEndpointAndRecord({ endpointId: 123, source: "manual" });

    expect(probeMockState.recordEndpointFailure).toHaveBeenCalledTimes(2);
    expect(probeMockState.recordProviderEndpointProbeResult).toHaveBeenCalledTimes(2);
  });

  test("probeEndpointUrl: TCP mode connects to host:port without HTTP request", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "TCP";

    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn(),
    };

    probeMockState.createConnection.mockImplementation((_opts: unknown, cb: () => void) => {
      queueMicrotask(cb);
      return mockSocket;
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeEndpointUrl("https://api.example.com:8443/v1", 5000);

    expect(result.ok).toBe(true);
    expect(result.method).toBe("TCP");
    expect(result.statusCode).toBeNull();
    expect(result.errorType).toBeNull();
    expect(result.latencyMs).toBeTypeOf("number");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("probeEndpointUrl: TCP mode defaults to port 80 for http URLs", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "TCP";

    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn(),
    };

    probeMockState.createConnection.mockImplementation((_opts: unknown, cb: () => void) => {
      queueMicrotask(cb);
      return mockSocket;
    });

    const result = await probeEndpointUrl("http://api.example.com/v1/messages", 5000);

    expect(result.ok).toBe(true);
    expect(result.method).toBe("TCP");
    expect(result.statusCode).toBeNull();
  });

  test("probeEndpointUrl: TCP mode returns invalid_url for bad URLs", async () => {
    process.env.ENDPOINT_PROBE_METHOD = "TCP";

    const result = await probeEndpointUrl("not-a-valid-url", 5000);

    expect(result.ok).toBe(false);
    expect(result.method).toBe("TCP");
    expect(result.errorType).toBe("invalid_url");
  });

  test("probeEndpointUrl: defaults to TCP when ENDPOINT_PROBE_METHOD is not set", async () => {
    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn(),
    };

    probeMockState.createConnection.mockImplementation((_opts: unknown, cb: () => void) => {
      queueMicrotask(cb);
      return mockSocket;
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeEndpointUrl("https://example.com", 5000);

    expect(result.method).toBe("TCP");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
