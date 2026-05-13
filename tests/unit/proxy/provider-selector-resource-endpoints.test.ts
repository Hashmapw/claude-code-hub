import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Provider } from "@/types/provider";

const circuitBreakerMocks = vi.hoisted(() => ({
  isCircuitOpen: vi.fn(async () => false),
  getCircuitState: vi.fn(() => "closed"),
}));

vi.mock("@/lib/circuit-breaker", () => circuitBreakerMocks);

const vendorTypeCircuitMocks = vi.hoisted(() => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => vendorTypeCircuitMocks);

const sessionManagerMocks = vi.hoisted(() => ({
  SessionManager: {
    getSessionProvider: vi.fn(async () => null as number | null),
    clearSessionProvider: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/session-manager", () => sessionManagerMocks);

const providerRepositoryMocks = vi.hoisted(() => ({
  findProviderById: vi.fn(async () => null as Provider | null),
  findAllProviders: vi.fn(async () => [] as Provider[]),
}));

vi.mock("@/repository/provider", () => providerRepositoryMocks);

const rateLimitMocks = vi.hoisted(() => ({
  RateLimitService: {
    checkCostLimitsWithLease: vi.fn(async () => ({ allowed: true })),
    checkTotalCostLimit: vi.fn(async () => ({ allowed: true, current: 0 })),
  },
}));

vi.mock("@/lib/rate-limit", () => rateLimitMocks);

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { ProxyProviderResolver } = await import("@/app/v1/_lib/proxy/provider-selector");

describe("ProxyProviderResolver.pickRandomProvider - resource endpoints without model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setupResolverMocks();
  });

  function createSessionStub(originalFormat: string, providers: Provider[]) {
    return {
      originalFormat,
      authState: null,
      getProvidersSnapshot: async () => providers,
      getOriginalModel: () => "",
      getCurrentModel: () => null,
      clientRequestsContext1m: () => false,
    } as any;
  }

  function createProvider(
    id: number,
    providerType: string,
    overrides: Partial<Provider> = {}
  ): Provider {
    return {
      id,
      name: `provider-${id}`,
      isEnabled: true,
      providerType,
      groupTag: null,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      allowedModels: ["guarded-model"],
      ...overrides,
    } as unknown as Provider;
  }

  function setupResolverMocks() {
    vi.spyOn(ProxyProviderResolver as any, "filterByLimits").mockImplementation(
      async (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectTopPriority").mockImplementation(
      (...args: unknown[]) => args[0] as Provider[]
    );
    vi.spyOn(ProxyProviderResolver as any, "selectOptimal").mockImplementation(
      (...args: unknown[]) => (args[0] as Provider[])[0] ?? null
    );
  }

  test("openai 资源端点在无 model 时仍应选择 openai-compatible provider", async () => {
    const incompatible = createProvider(1, "claude");
    const compatible = createProvider(2, "openai-compatible");
    const session = createSessionStub("openai", [incompatible, compatible]);

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("openai-compatible");
    expect(context.requestedModel).toBe("");
  });

  test("response 资源端点在无 model 时仍应选择 codex provider", async () => {
    const incompatible = createProvider(1, "openai-compatible");
    const compatible = createProvider(2, "codex");
    const session = createSessionStub("response", [incompatible, compatible]);

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("codex");
    expect(context.requestedModel).toBe("");
  });

  test("gemini 资源端点在无 model 时仍应选择 gemini provider", async () => {
    const incompatible = createProvider(1, "gemini-cli");
    const compatible = createProvider(2, "gemini");
    const session = createSessionStub("gemini", [incompatible, compatible]);

    const { provider, context } = await (ProxyProviderResolver as any).pickRandomProvider(
      session,
      []
    );

    expect(provider?.id).toBe(2);
    expect(provider?.providerType).toBe("gemini");
    expect(context.requestedModel).toBe("");
  });
});
