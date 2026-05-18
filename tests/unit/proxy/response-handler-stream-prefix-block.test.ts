import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import {
  STREAM_PREFIX_BLOCK_CATEGORY,
  STREAM_PREFIX_BLOCK_DEFAULT_MESSAGE_CODE,
  type ResolvedStreamPrefixBlockRule,
} from "@/lib/stream-prefix-block-rule";
import type { Provider } from "@/types/provider";

const mocks = vi.hoisted(() => ({
  getStreamPrefixBlockRulesForProvider:
    vi.fn<(_: number | null | undefined) => ResolvedStreamPrefixBlockRule[]>(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
  deleteLiveChain: vi.fn(),
  endRequest: vi.fn(),
  getLocale: vi.fn(),
  getErrorMessageServer: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: {
    getStreamPrefixBlockRulesForProvider: mocks.getStreamPrefixBlockRulesForProvider,
  },
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
  updateMessageRequestDuration: mocks.updateMessageRequestDuration,
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: mocks.endRequest,
    }),
  },
}));

vi.mock("@/lib/redis/live-chain-store", () => ({
  deleteLiveChain: mocks.deleteLiveChain,
}));

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("next-intl/server", () => ({
  getLocale: mocks.getLocale,
}));

vi.mock("@/lib/utils/error-messages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/error-messages")>(
    "@/lib/utils/error-messages"
  );
  return {
    ...actual,
    getErrorMessageServer: mocks.getErrorMessageServer,
  };
});

vi.mock("@/lib/price-sync/cloud-price-updater", () => ({
  requestCloudPriceTableSync: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {},
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    storeSessionResponse: vi.fn(),
    storeSessionResponsePhaseSnapshot: vi.fn(),
    updateSessionUsage: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "provider-1",
    url: "https://example.com",
    key: "key",
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
    modelRedirects: null,
    allowedModels: null,
    allowedClients: null,
    blockedClients: null,
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
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 0,
    streamingIdleTimeoutMs: 0,
    requestTimeoutNonStreamingMs: 0,
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

function createSession(provider: Provider): ProxySession {
  const session = Object.create(ProxySession.prototype);
  const responseController = new AbortController();
  Object.assign(session, {
    startTime: Date.now(),
    provider,
    messageContext: {
      id: 101,
      user: { id: 7, name: "tester" },
    },
    request: {
      model: "claude-3-7-sonnet",
    },
    sessionId: null,
    requestSequence: 1,
    clientAbortSignal: new AbortController().signal,
    responseController,
    providerChain: [],
    getProviderChain: () => [],
    getCurrentModel: () => "claude-3-7-sonnet",
    getContext1mApplied: () => false,
    getSpecialSettings: () => [],
    shouldTrackSessionObservability: () => false,
  });
  return session as ProxySession;
}

function createSseResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
}

async function loadApplyStreamPrefixBlockGate() {
  vi.unmock("@/app/v1/_lib/proxy/response-handler");
  const module = await import("@/app/v1/_lib/proxy/response-handler");
  return module.applyStreamPrefixBlockGate;
}

describe("applyStreamPrefixBlockGate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unmock("@/app/v1/_lib/proxy/response-handler");
    mocks.getStreamPrefixBlockRulesForProvider.mockReset();
    mocks.updateMessageRequestDetails.mockReset();
    mocks.updateMessageRequestDuration.mockReset();
    mocks.deleteLiveChain.mockReset();
    mocks.endRequest.mockReset();
    mocks.getLocale.mockReset();
    mocks.getLocale.mockResolvedValue("en");
    mocks.getErrorMessageServer.mockReset();
    mocks.getErrorMessageServer.mockImplementation(async (_locale: string, code: string) => code);
  });

  test("blocks SSE response when prefix contains configured keyword", async () => {
    mocks.getStreamPrefixBlockRulesForProvider.mockReturnValue([
      {
        id: 99,
        pattern: "175877552",
        keywords: ["175877552"],
        normalizedKeywords: ["175877552"],
        providerIds: [1],
        scanLimitBytes: 16,
        statusCode: 403,
        message: "blocked by prefix policy",
        overrideResponse: null,
        overrideStatusCode: null,
        description: JSON.stringify({ keywords: ["175877552"], providerIds: [1] }),
      },
    ]);

    const provider = createProvider({ id: 1 });
    const session = createSession(provider);
    const response = createSseResponse("data: before 175877552 after\n\n");
    const applyStreamPrefixBlockGate = await loadApplyStreamPrefixBlockGate();

    const blocked = await applyStreamPrefixBlockGate(session, response);

    expect(blocked.status).toBe(403);
    expect(await blocked.text()).toContain("blocked by prefix policy");
    expect(mocks.updateMessageRequestDuration).toHaveBeenCalledWith(101, expect.any(Number));
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        statusCode: 403,
        providerId: 1,
      })
    );
    expect(mocks.endRequest).toHaveBeenCalledWith(7, 101);
  });

  test("uses i18n default message when stream prefix rule has no explicit message", async () => {
    mocks.getStreamPrefixBlockRulesForProvider.mockReturnValue([
      {
        id: 101,
        pattern: "175877552",
        keywords: ["175877552"],
        normalizedKeywords: ["175877552"],
        providerIds: [1],
        scanLimitBytes: 32,
        statusCode: 403,
        message: STREAM_PREFIX_BLOCK_DEFAULT_MESSAGE_CODE,
        hasExplicitMessage: false,
        overrideResponse: null,
        overrideStatusCode: null,
        description: JSON.stringify({ keywords: ["175877552"], providerIds: [1] }),
      },
    ]);

    const provider = createProvider({ id: 1 });
    const session = createSession(provider);
    const response = createSseResponse("data: before 175877552 after\n\n");
    const applyStreamPrefixBlockGate = await loadApplyStreamPrefixBlockGate();

    const blocked = await applyStreamPrefixBlockGate(session, response);
    const body = await blocked.json();

    expect(blocked.status).toBe(403);
    expect(body).toMatchObject({
      error: {
        message: "STREAM_PREFIX_BLOCKED",
        details: {
          reason: "stream_prefix_block",
          ruleId: 101,
          matchedKeyword: "175877552",
        },
      },
    });
    expect(mocks.getLocale).toHaveBeenCalled();
    expect(mocks.getErrorMessageServer).toHaveBeenCalledWith("en", "STREAM_PREFIX_BLOCKED");
  });

  test("passes through buffered SSE response when no keyword matches", async () => {
    mocks.getStreamPrefixBlockRulesForProvider.mockReturnValue([
      {
        id: 100,
        pattern: "175877552",
        keywords: ["175877552"],
        normalizedKeywords: ["175877552"],
        providerIds: [1],
        scanLimitBytes: 16,
        statusCode: 403,
        message: "blocked by prefix policy",
        overrideResponse: null,
        overrideStatusCode: null,
        description: JSON.stringify({ keywords: ["175877552"], providerIds: [1] }),
      },
    ]);

    const provider = createProvider({ id: 1 });
    const session = createSession(provider);
    const response = createSseResponse("data: hello world\n\ndata: tail\n\n");
    const applyStreamPrefixBlockGate = await loadApplyStreamPrefixBlockGate();

    const resumed = await applyStreamPrefixBlockGate(session, response);

    expect(resumed.status).toBe(200);
    expect(await resumed.text()).toBe("data: hello world\n\ndata: tail\n\n");
    expect(mocks.updateMessageRequestDetails).not.toHaveBeenCalled();
  });
});
