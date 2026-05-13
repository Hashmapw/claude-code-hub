import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicStatusCurrentSnapshotKey,
  buildPublicStatusManifestKey,
  buildPublicStatusRebuildHintKey,
} from "@/lib/public-status/redis-contract";

const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisDel = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisEval = vi.hoisted(() => vi.fn());
const mockRedisPttl = vi.hoisted(() => vi.fn());
const mockReadCurrentInternalPublicStatusConfigSnapshot = vi.hoisted(() => vi.fn());
const mockGetConfiguredPublicStatusGroups = vi.hoisted(() => vi.fn());
const mockQueryPublicStatusRequests = vi.hoisted(() => vi.fn());
const mockBuildPublicStatusPayloadFromRequests = vi.hoisted(() => vi.fn());
const mockPublishCurrentPublicStatusConfigProjection = vi.hoisted(() => vi.fn());
const aggregationMockState = vi.hoisted(() => ({ useMockedExports: false }));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => ({
    get: mockRedisGet,
    pttl: mockRedisPttl,
    set: mockRedisSet,
    del: mockRedisDel,
    eval: mockRedisEval,
    status: "ready",
  }),
}));

vi.mock("@/lib/public-status/config-snapshot", () => ({
  readCurrentInternalPublicStatusConfigSnapshot: mockReadCurrentInternalPublicStatusConfigSnapshot,
}));

vi.mock("@/lib/public-status/config-publisher", () => ({
  publishCurrentPublicStatusConfigProjection: mockPublishCurrentPublicStatusConfigProjection,
}));

vi.mock("@/lib/public-status/aggregation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-status/aggregation")>();

  return {
    ...actual,
    getConfiguredPublicStatusGroups: (
      ...args: Parameters<typeof actual.getConfiguredPublicStatusGroups>
    ) =>
      aggregationMockState.useMockedExports
        ? mockGetConfiguredPublicStatusGroups(...args)
        : actual.getConfiguredPublicStatusGroups(...args),
    queryPublicStatusRequests: (...args: Parameters<typeof actual.queryPublicStatusRequests>) =>
      aggregationMockState.useMockedExports
        ? mockQueryPublicStatusRequests(...args)
        : actual.queryPublicStatusRequests(...args),
    buildPublicStatusPayloadFromRequests: (
      ...args: Parameters<typeof actual.buildPublicStatusPayloadFromRequests>
    ) =>
      aggregationMockState.useMockedExports
        ? mockBuildPublicStatusPayloadFromRequests(...args)
        : actual.buildPublicStatusPayloadFromRequests(...args),
  };
});

const aggregationModule = await import("@/lib/public-status/aggregation");
const rebuildWorkerModule = await import("@/lib/public-status/rebuild-worker");
const rebuildHintsModule = await import("@/lib/public-status/rebuild-hints");

function useRealAggregation() {
  aggregationMockState.useMockedExports = false;
}

function useMockedAggregation() {
  aggregationMockState.useMockedExports = true;
}

describe("public-status rebuild worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealAggregation();
    mockRedisGet.mockResolvedValue(null);
    mockRedisEval.mockResolvedValue(1);
    mockRedisPttl.mockResolvedValue(-1);
    mockGetConfiguredPublicStatusGroups.mockImplementation(
      (snapshot: { groups: unknown[] }) => snapshot.groups
    );
    mockPublishCurrentPublicStatusConfigProjection.mockResolvedValue({
      configVersion: "cfg-1",
      key: "public-status:v1:config:cfg-1",
      written: true,
      groupCount: 1,
    });
  });

  it("aggregates canonical request rows by public group, model key, and UTC bucket", () => {
    const result = aggregationModule.buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: "Primary fleet",
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
      requests: [
        {
          id: 1,
          createdAt: "2026-04-21T10:10:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1000,
          ttfbMs: 200,
          outputTokens: 80,
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
        {
          id: 2,
          createdAt: "2026-04-21T10:40:00.000Z",
          originalModel: "gpt-4.1",
          durationMs: 1400,
          ttfbMs: 300,
          outputTokens: 60,
          providerChain: [
            {
              id: 11,
              name: "provider-1",
              groupTag: "openai",
              reason: "retry_failed",
              statusCode: 500,
            },
          ],
        },
      ],
    });

    expect(result.coveredFrom).toBe("2026-04-21T10:00:00.000Z");
    expect(result.coveredTo).toBe("2026-04-21T11:00:00.000Z");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.publicGroupSlug).toBe("openai");
    expect(result.groups[0]?.models[0]?.publicModelKey).toBe("gpt-4.1");
    expect(result.groups[0]?.models[0]?.timeline).toHaveLength(4);
    expect(result.groups[0]?.models[0]?.timeline[0]?.bucketStart).toBe("2026-04-21T10:00:00.000Z");
    expect(result.groups[0]?.models[0]?.latestState).toBe("failed");
  });

  it("keeps default group samples when provider-chain tags are null blank or explicit default", () => {
    const result = aggregationModule.buildPublicStatusPayloadFromRequests({
      rangeHours: 1,
      intervalMinutes: 15,
      now: "2026-04-21T11:00:00.000Z",
      groups: [
        {
          sourceGroupName: "default",
          publicGroupSlug: "platform",
          displayName: "Platform",
          explanatoryCopy: "Default group",
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
      requests: [
        {
          id: 31,
          createdAt: "2026-04-21T10:10:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 311,
              name: "provider-1",
              groupTag: null,
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
        {
          id: 32,
          createdAt: "2026-04-21T10:20:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 321,
              name: "provider-2",
              groupTag: "",
              reason: "retry_failed",
              statusCode: 500,
            },
          ],
        },
        {
          id: 33,
          createdAt: "2026-04-21T10:30:00.000Z",
          originalModel: "gpt-4.1",
          providerChain: [
            {
              id: 331,
              name: "provider-3",
              groupTag: "default",
              reason: "request_success",
              statusCode: 200,
            },
          ],
        },
      ],
    });

    const model = result.groups[0]?.models[0];
    expect(model?.timeline.reduce((sum, bucket) => sum + bucket.sampleCount, 0)).toBe(3);
    expect(model?.latestState).toBe("operational");
  });

  it("collapses concurrent rebuild requests into a single in-flight computation", async () => {
    useMockedAggregation();

    let releaseCompute: (() => void) | undefined;
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve;
    });
    const computeGeneration = vi.fn(async () => {
      await computeGate;
      return { sourceGeneration: "generation-1" };
    });

    const first = rebuildWorkerModule.runPublicStatusRebuild({
      flightKey: "cfg-1:5m:24h",
      computeGeneration,
    });
    const second = rebuildWorkerModule.runPublicStatusRebuild({
      flightKey: "cfg-1:5m:24h",
      computeGeneration,
    });
    const third = rebuildWorkerModule.runPublicStatusRebuild({
      flightKey: "cfg-1:5m:24h",
      computeGeneration,
    });

    await Promise.resolve();
    expect(computeGeneration).toHaveBeenCalledTimes(1);

    releaseCompute?.();

    const results = await Promise.all([first, second, third]);

    expect(computeGeneration).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { sourceGeneration: "generation-1" },
      { sourceGeneration: "generation-1" },
      { sourceGeneration: "generation-1" },
    ]);
  });

  it("propagates distributed-lock skip state to piggyback callers", async () => {
    useMockedAggregation();

    let releaseCompute: (() => void) | undefined;
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve;
    });
    const computeGeneration = vi.fn(async () => {
      await computeGate;
      return {
        sourceGeneration: "generation-2",
        skippedDueToDistributedLock: true,
      };
    });

    const first = rebuildWorkerModule.runPublicStatusRebuild({
      flightKey: "cfg-2:15m:48h",
      computeGeneration,
    });
    const second = rebuildWorkerModule.runPublicStatusRebuild({
      flightKey: "cfg-2:15m:48h",
      computeGeneration,
    });

    await Promise.resolve();
    expect(computeGeneration).toHaveBeenCalledTimes(1);

    releaseCompute?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        sourceGeneration: "generation-2",
        skippedDueToDistributedLock: true,
      },
      {
        sourceGeneration: "generation-2",
        skippedDueToDistributedLock: true,
      },
    ]);
  });

  it("publishes snapshot and manifest records for a rebuilt generation", async () => {
    useMockedAggregation();

    mockReadCurrentInternalPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
      generatedAt: "2026-04-21T10:00:00.000Z",
      siteTitle: "Claude Code Hub Status",
      siteDescription: "Request-derived public status",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [
        {
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: "Primary fleet",
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
    });
    mockQueryPublicStatusRequests.mockResolvedValue([]);
    mockBuildPublicStatusPayloadFromRequests.mockReturnValue({
      generatedAt: "2026-04-21T10:00:00.000Z",
      coveredFrom: "2026-04-20T10:00:00.000Z",
      coveredTo: "2026-04-21T10:00:00.000Z",
      groups: [],
    });
    mockRedisSet.mockReset();
    mockRedisSet.mockResolvedValueOnce("OK");

    const result = await rebuildWorkerModule.rebuildPublicStatusProjection({
      intervalMinutes: 5,
      rangeHours: 24,
      now: new Date("2026-04-21T10:02:00.000Z"),
    });

    expect(result.status).toBe("updated");
    const versionedManifestKey = buildPublicStatusManifestKey({
      configVersion: "cfg-1",
      intervalMinutes: 5,
      rangeHours: 24,
    });
    const versionedManifestCall = mockRedisSet.mock.calls.find(
      (call) => call[0] === versionedManifestKey
    );

    expect(versionedManifestCall).toBeTruthy();

    const manifestValue = JSON.parse(String(versionedManifestCall?.[1]));
    expect(manifestValue.configVersion).toBe("cfg-1");
    expect(manifestValue.lastCompleteGeneration).toBeTruthy();
    expect(mockRedisEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      expect.stringContaining("public-status:v1:rebuild-lock:"),
      expect.any(String)
    );
    expect(mockRedisDel).toHaveBeenCalled();

    const snapshotKey = buildPublicStatusCurrentSnapshotKey({
      intervalMinutes: 5,
      rangeHours: 24,
      generation: manifestValue.lastCompleteGeneration,
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      snapshotKey,
      expect.any(String),
      "EX",
      60 * 60 * 24 * 30
    );
  });

  it("re-publishes config projection before rebuild when redis config keys are missing", async () => {
    useMockedAggregation();

    mockReadCurrentInternalPublicStatusConfigSnapshot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        configVersion: "cfg-1",
        generatedAt: "2026-04-21T10:00:00.000Z",
        siteTitle: "Claude Code Hub Status",
        siteDescription: "Request-derived public status",
        defaultIntervalMinutes: 5,
        defaultRangeHours: 24,
        groups: [
          {
            sourceGroupName: "openai",
            publicGroupSlug: "openai",
            displayName: "OpenAI",
            explanatoryCopy: "Primary fleet",
            sortOrder: 1,
            models: [
              {
                publicModelKey: "gpt-4.1",
                label: "GPT-4.1",
                vendorIconKey: "openai",
                requestTypeBadge: "openaiCompatible",
              },
            ],
          },
        ],
      });
    mockQueryPublicStatusRequests.mockResolvedValue([]);
    mockBuildPublicStatusPayloadFromRequests.mockReturnValue({
      generatedAt: "2026-04-21T10:00:00.000Z",
      coveredFrom: "2026-04-20T10:00:00.000Z",
      coveredTo: "2026-04-21T10:00:00.000Z",
      groups: [],
    });
    mockRedisSet.mockReset();
    mockRedisSet.mockResolvedValueOnce("OK");

    const result = await rebuildWorkerModule.rebuildPublicStatusProjection({
      intervalMinutes: 5,
      rangeHours: 24,
      now: new Date("2026-04-21T10:02:00.000Z"),
    });

    expect(result.status).toBe("updated");
    expect(mockPublishCurrentPublicStatusConfigProjection).toHaveBeenCalledWith({
      reason: "rebuild-bootstrap",
    });
  });

  it("writes rebuild hints with ttl and reason payload", async () => {
    await rebuildHintsModule.schedulePublicStatusRebuild({
      intervalMinutes: 15,
      rangeHours: 48,
      reason: "manifest-missing",
    });

    const hintKey = buildPublicStatusRebuildHintKey({
      intervalMinutes: 15,
      rangeHours: 48,
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      hintKey,
      expect.stringContaining("manifest-missing"),
      "EX",
      300
    );
  });

  it("preserves manifest ttl when marking rebuildState as rebuilding", async () => {
    mockReadCurrentInternalPublicStatusConfigSnapshot.mockResolvedValue({
      configVersion: "cfg-1",
    });
    mockRedisGet
      .mockResolvedValueOnce(
        JSON.stringify({
          configVersion: "cfg-1",
          rebuildState: "idle",
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          configVersion: "cfg-1",
          rebuildState: "idle",
        })
      );
    mockRedisPttl.mockResolvedValueOnce(2_592_000_000).mockResolvedValueOnce(-1);

    await rebuildHintsModule.schedulePublicStatusRebuild({
      intervalMinutes: 5,
      rangeHours: 24,
      reason: "stale-generation",
    });

    expect(mockRedisSet).toHaveBeenCalledWith(
      "public-status:v1:manifest:cfg-1:5m:24h",
      expect.stringContaining('"rebuildState":"rebuilding"'),
      "PX",
      2_592_000_000
    );
    expect(mockRedisSet).toHaveBeenCalledWith(
      "public-status:v1:manifest:current:5m:24h",
      expect.stringContaining('"rebuildState":"rebuilding"')
    );
  });
});
