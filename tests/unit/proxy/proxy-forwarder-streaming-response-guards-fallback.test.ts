import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";

const mocks = vi.hoisted(() => ({
  pickRandomProviderWithExclusion: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(async () => {}),
  getCircuitState: vi.fn(() => "closed"),
  getProviderHealthInfo: vi.fn(async () => ({
    health: { failureCount: 0 },
    config: { failureThreshold: 3 },
  })),
  updateSessionBindingSmart: vi.fn(async () => ({ updated: true, reason: "test" })),
  updateSessionProvider: vi.fn(async () => {}),
  clearSessionProvider: vi.fn(async () => {}),
  storeSessionSpecialSettings: vi.fn(async () => {}),
  storeSessionRequestPhaseSnapshot: vi.fn(async () => {}),
  storeSessionResponsePhaseSnapshot: vi.fn(async () => {}),
  isHttp2Enabled: vi.fn(async () => false),
  getPreferredProviderEndpoints: vi.fn(async () => []),
  getEndpointFilterStats: vi.fn(async () => null),
  recordEndpointSuccess: vi.fn(async () => {}),
  recordEndpointFailure: vi.fn(async () => {}),
  isVendorTypeCircuitOpen: vi.fn(async () => false),
  recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
  checkAndTrackProviderSession: vi.fn(async () => ({
    allowed: true,
    count: 1,
    tracked: true,
    referenced: true,
  })),
  releaseProviderSession: vi.fn(async () => {}),
  detectErrorRule: vi.fn(() => ({ matched: false })),
  detectErrorRuleAsync: vi.fn(async () => ({ matched: false })),
  updateMessageRequestDetails: vi.fn(async () => {}),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCachedSystemSettings: vi.fn(async () => ({
      enableThinkingSignatureRectifier: true,
      enableThinkingBudgetRectifier: true,
      enableClaudeMetadataUserIdInjection: false,
      enableBillingHeaderRectifier: false,
      enableResponseFixer: false,
      enableResponseInputRectifier: true,
    })),
    isHttp2Enabled: mocks.isHttp2Enabled,
  };
});

vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({
  getPreferredProviderEndpoints: mocks.getPreferredProviderEndpoints,
  getEndpointFilterStats: mocks.getEndpointFilterStats,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: mocks.recordEndpointSuccess,
  recordEndpointFailure: mocks.recordEndpointFailure,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: mocks.isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout: mocks.recordVendorTypeAllEndpointsTimeout,
}));

vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    checkAndTrackProviderSession: mocks.checkAndTrackProviderSession,
    releaseProviderSession: mocks.releaseProviderSession,
  },
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionBindingSmart: mocks.updateSessionBindingSmart,
    updateSessionProvider: mocks.updateSessionProvider,
    clearSessionProvider: mocks.clearSessionProvider,
    storeSessionSpecialSettings: mocks.storeSessionSpecialSettings,
    storeSessionRequestPhaseSnapshot: mocks.storeSessionRequestPhaseSnapshot,
    storeSessionResponsePhaseSnapshot: mocks.storeSessionResponsePhaseSnapshot,
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    pickRandomProviderWithExclusion: mocks.pickRandomProviderWithExclusion,
  },
}));

vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: {
    detect: mocks.detectErrorRule,
    detectAsync: mocks.detectErrorRuleAsync,
    hasInitialized: vi.fn(() => true),
  },
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
}));

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function createProvider(id: number, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `provider-${id}`,
    url: `https://provider-${id}.example.com`,
    key: `key-${id}`,
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    disableSessionReuse: false,
    rejectStreamingContentLength: false,
    rejectStreamingZeroUsage: false,
    modelRedirects: null,
    allowedModels: null,
    blockedClients: null,
    allowedClients: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limit5hResetMode: "rolling",
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: 1,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 0,
    streamingIdleTimeoutMs: 10_000,
    requestTimeoutNonStreamingMs: 600_000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    codexServiceTierPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: false,
    geminiGoogleSearchPreference: null,
    tpm: 0,
    rpm: 0,
    rpd: 0,
    cc: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function createSession(): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "claude-test",
      log: "(test)",
      message: {
        model: "claude-test",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
    sessionId: "sess-streaming-response-guards-fallback",
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    providersSnapshot: [],
    endpointPolicy: resolveEndpointPolicy("/v1/messages"),
    isHeaderModified: () => false,
    isProbeRequest: () => false,
    shouldTrackSessionObservability: () => false,
    shouldPersistSessionDebugArtifacts: () => false,
  });

  return session as ProxySession;
}

function setProviderWithSessionRef(session: ProxySession, provider: Provider): void {
  session.setProvider(provider);
  session.recordProviderSessionRef(provider.id);
}

function createSseResponse(text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      ...headers,
    },
  });
}

describe("ProxyForwarder streaming response guards fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectErrorRule.mockReturnValue({ matched: false });
    mocks.detectErrorRuleAsync.mockResolvedValue({ matched: false });
    mocks.checkAndTrackProviderSession.mockResolvedValue({
      allowed: true,
      count: 1,
      tracked: true,
      referenced: true,
    });
  });

  test("non-hedge streaming Content-Length guard should skip provider and continue with next provider", async () => {
    const provider1 = createProvider(1, {
      name: "content-length-provider",
      firstByteTimeoutStreamingMs: 0,
      maxRetryAttempts: 3,
      rejectStreamingContentLength: true,
    });
    const provider2 = createProvider(2, {
      name: "healthy-provider",
      firstByteTimeoutStreamingMs: 0,
    });
    const session = createSession();
    setProviderWithSessionRef(session, provider1);

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => Promise<Response> },
      "doForward"
    );
    doForward
      .mockResolvedValueOnce(createSseResponse("data: provider-1\n\n", { "content-length": "18" }))
      .mockResolvedValueOnce(createSseResponse("data: provider-2-ok\n\n"));

    const response = await ProxyForwarder.send(session);

    expect(await response.text()).toBe("data: provider-2-ok\n\n");
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(doForward.mock.calls[0]?.[1]).toMatchObject({ id: 1 });
    expect(doForward.mock.calls[1]?.[1]).toMatchObject({ id: 2 });
    expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalledWith(session, [1]);
    expect(mocks.recordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ statusCode: 503 })
    );
    expect(session.getProviderChain()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          reason: "retry_failed",
          statusCode: 503,
          errorDetails: expect.objectContaining({
            provider: expect.objectContaining({
              upstreamParsed: expect.objectContaining({
                error: expect.objectContaining({ type: "streaming_content_length_rejected" }),
              }),
            }),
          }),
        }),
      ])
    );
    expect(session.provider?.id).toBe(2);
  });

  test("non-hedge zero-usage stream guard should fail before flushing and continue with next provider", async () => {
    const provider1 = createProvider(1, {
      name: "zero-usage-provider",
      firstByteTimeoutStreamingMs: 0,
      maxRetryAttempts: 3,
      rejectStreamingZeroUsage: true,
    });
    const provider2 = createProvider(2, {
      name: "healthy-provider",
      firstByteTimeoutStreamingMs: 0,
    });
    const session = createSession();
    setProviderWithSessionRef(session, provider1);

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

    const zeroUsageStream = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":0}}}',
      "",
      'data: {"type":"message_delta","usage":{"output_tokens":0}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => Promise<Response> },
      "doForward"
    );
    doForward
      .mockResolvedValueOnce(createSseResponse(zeroUsageStream))
      .mockResolvedValueOnce(createSseResponse("data: provider-2-ok\n\n"));

    const response = await ProxyForwarder.send(session);

    expect(await response.text()).toBe("data: provider-2-ok\n\n");
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(doForward.mock.calls[0]?.[1]).toMatchObject({ id: 1 });
    expect(doForward.mock.calls[1]?.[1]).toMatchObject({ id: 2 });
    expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalledWith(session, [1]);
    expect(mocks.recordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ statusCode: 503 })
    );
    expect(session.getProviderChain()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          reason: "retry_failed",
          statusCode: 503,
          errorDetails: expect.objectContaining({
            provider: expect.objectContaining({
              upstreamParsed: expect.objectContaining({
                error: expect.objectContaining({ type: "streaming_zero_usage_rejected" }),
              }),
            }),
          }),
        }),
      ])
    );
    expect(session.provider?.id).toBe(2);
  });
});
