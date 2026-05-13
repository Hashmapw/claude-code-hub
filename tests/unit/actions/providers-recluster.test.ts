import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();
const findProviderVendorByIdMock = vi.fn();
const getOrCreateProviderVendorIdFromUrlsMock = vi.fn();
const computeVendorKeyMock = vi.fn();
const backfillProviderEndpointsFromProvidersMock = vi.fn();
const tryDeleteProviderVendorIfEmptyMock = vi.fn();
const publishProviderCacheInvalidationMock = vi.fn();
const emitActionAuditMock = vi.fn();
const ensureProviderGroupsExistMock = vi.fn();
const dbMock = {
  transaction: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn(async () => []),
  findAllProvidersFresh: findAllProvidersFreshMock,
  findProviderById: vi.fn(async () => null),
}));

vi.mock("@/repository/provider-endpoints", () => ({
  computeVendorKey: computeVendorKeyMock,
  findProviderVendorById: findProviderVendorByIdMock,
  findProviderVendorsByIds: vi.fn(async (vendorIds: number[]) => {
    const vendors = await Promise.all(vendorIds.map((id) => findProviderVendorByIdMock(id)));
    return vendors.filter((vendor): vendor is NonNullable<typeof vendor> => vendor !== null);
  }),
  getOrCreateProviderVendorIdFromUrls: getOrCreateProviderVendorIdFromUrlsMock,
  backfillProviderEndpointsFromProviders: backfillProviderEndpointsFromProvidersMock,
  tryDeleteProviderVendorIfEmpty: tryDeleteProviderVendorIfEmptyMock,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishProviderCacheInvalidationMock,
}));

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: emitActionAuditMock,
}));

vi.mock("@/drizzle/db", () => ({
  db: dbMock,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(() => Symbol("eq")),
  };
});

vi.mock("@/drizzle/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/drizzle/schema")>();
  return {
    ...actual,
    providers: {
      ...actual.providers,
      id: actual.providers.id,
    },
  };
});

vi.mock("@/lib/circuit-breaker", () => ({
  clearConfigCache: vi.fn(),
  clearProviderState: vi.fn(async () => undefined),
  forceCloseCircuitState: vi.fn(async () => undefined),
  getAllHealthStatusAsync: vi.fn(async () => ({})),
  publishCircuitBreakerConfigInvalidation: vi.fn(async () => undefined),
  resetCircuit: vi.fn(),
}));

vi.mock("@/lib/redis/circuit-breaker-config", () => ({
  deleteProviderCircuitConfig: vi.fn(async () => undefined),
  saveProviderCircuitConfig: vi.fn(async () => undefined),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    terminateProviderSessionsBatch: vi.fn(async () => 0),
    terminateStickySessionsForProviders: vi.fn(async () => 0),
  },
}));

vi.mock("@/lib/redis/redis-kv-store", () => ({
  RedisKVStore: class {
    async get() {
      return null;
    }

    async set() {}

    async delete() {}
  },
}));

vi.mock("@/repository/provider-groups", () => ({
  ensureProviderGroupsExist: ensureProviderGroupsExistMock,
}));

vi.mock("@/app/v1/_lib/gemini/auth", () => ({
  GeminiAuth: class {},
}));

vi.mock("@/app/v1/_lib/headers", () => ({
  resolveAnthropicAuthHeaders: vi.fn(),
}));

vi.mock("@/app/v1/_lib/url", () => ({
  buildProxyUrl: vi.fn(),
}));

vi.mock("@/lib/provider-testing", () => ({
  executeProviderTest: vi.fn(),
}));

vi.mock("@/lib/provider-testing/presets", () => ({
  getPresetsForProvider: vi.fn(async () => []),
}));

vi.mock("@/lib/proxy-agent", () => ({
  createProxyAgentForProvider: vi.fn(),
  isValidProxyUrl: vi.fn(() => true),
}));

vi.mock("@/lib/validation/schemas", () => ({
  CreateProviderSchema: { parse: vi.fn((value) => value) },
  UpdateProviderSchema: { parse: vi.fn((value) => value) },
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

const providerActions = await import("@/actions/providers");

describe("reclusterProviderVendors", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllProvidersFreshMock.mockResolvedValue([]);
    ensureProviderGroupsExistMock.mockResolvedValue(undefined);
  });

  describe("permission checks", () => {
    it("returns error when not logged in", async () => {
      getSessionMock.mockResolvedValue(null);

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error when user is not admin", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("allows admin users", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([]);

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
    });
  });

  describe("preview mode (confirm=false)", () => {
    it("returns empty changes when no providers", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([]);

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(false);
        expect(result.data.changes).toEqual([]);
        expect(result.data.preview.providersMoved).toBe(0);
      }
    });

    it("detects providers that need vendor change", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
        {
          id: 2,
          name: "Provider 2",
          url: "http://192.168.1.1:9090/v1/messages",
          websiteUrl: null,
          providerVendorId: 1, // Same vendor but different port - should change
        },
      ]);

      // Current vendor has domain "192.168.1.1" (old behavior)
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });

      // New vendor keys include port
      computeVendorKeyMock
        .mockReturnValueOnce("192.168.1.1:8080")
        .mockReturnValueOnce("192.168.1.1:9090");

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(false);
        expect(result.data.preview.providersMoved).toBe(2);
        expect(result.data.changes.length).toBe(2);
      }
    });

    it("does not modify database in preview mode", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });
      computeVendorKeyMock.mockReturnValue("192.168.1.1:8080");

      const { reclusterProviderVendors } = providerActions;
      await reclusterProviderVendors({ confirm: false });

      expect(dbMock.transaction).not.toHaveBeenCalled();
      expect(publishProviderCacheInvalidationMock).not.toHaveBeenCalled();
    });

    it("skips providers with invalid URLs", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Invalid Provider",
          url: "://invalid",
          websiteUrl: null,
          providerVendorId: null,
        },
      ]);
      computeVendorKeyMock.mockReturnValue(null);

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: false });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.preview.skippedInvalidUrl).toBe(1);
        expect(result.data.preview.providersMoved).toBe(0);
      }
    });
  });

  describe("apply mode (confirm=true)", () => {
    it("executes database updates in transaction", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });
      computeVendorKeyMock.mockReturnValue("192.168.1.1:8080");
      getOrCreateProviderVendorIdFromUrlsMock.mockResolvedValue(2);
      backfillProviderEndpointsFromProvidersMock.mockResolvedValue({});
      tryDeleteProviderVendorIfEmptyMock.mockResolvedValue(true);
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue({}),
          }),
        }),
      };
      dbMock.transaction.mockImplementation(async (fn) => {
        return fn(tx);
      });

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(true);
      }
      expect(dbMock.transaction).toHaveBeenCalled();
      expect(getOrCreateProviderVendorIdFromUrlsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerUrl: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
        }),
        { tx }
      );
    });

    it("publishes cache invalidation after apply", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1",
      });
      computeVendorKeyMock.mockReturnValue("192.168.1.1:8080");
      getOrCreateProviderVendorIdFromUrlsMock.mockResolvedValue(2);
      backfillProviderEndpointsFromProvidersMock.mockResolvedValue({});
      tryDeleteProviderVendorIfEmptyMock.mockResolvedValue(true);
      dbMock.transaction.mockImplementation(async (fn) => {
        return fn({
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue({}),
            }),
          }),
        });
      });

      const { reclusterProviderVendors } = providerActions;
      await reclusterProviderVendors({ confirm: true });

      expect(publishProviderCacheInvalidationMock).toHaveBeenCalled();
    });

    it("does not apply when no changes needed", async () => {
      getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
      findAllProvidersFreshMock.mockResolvedValue([
        {
          id: 1,
          name: "Provider 1",
          url: "http://192.168.1.1:8080/v1/messages",
          websiteUrl: null,
          providerVendorId: 1,
        },
      ]);
      // Vendor already has correct domain
      findProviderVendorByIdMock.mockResolvedValue({
        id: 1,
        websiteDomain: "192.168.1.1:8080",
      });
      computeVendorKeyMock.mockReturnValue("192.168.1.1:8080");

      const { reclusterProviderVendors } = providerActions;
      const result = await reclusterProviderVendors({ confirm: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.applied).toBe(true);
        expect(result.data.preview.providersMoved).toBe(0);
      }
      expect(dbMock.transaction).not.toHaveBeenCalled();
    });
  });
});
