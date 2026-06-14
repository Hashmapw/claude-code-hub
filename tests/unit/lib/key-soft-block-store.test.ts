import { beforeEach, describe, expect, it, vi } from "vitest";

const getRedisClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/redis/client", () => ({
  getRedisClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("key soft block Redis store", () => {
  beforeEach(() => {
    vi.resetModules();
    getRedisClient.mockReset();
  });

  it("fails open when Redis is unavailable", async () => {
    getRedisClient.mockReturnValue(null);

    const { getKeySoftBlockConfig, getKeySoftBlockConfigs } = await import(
      "@/lib/key-soft-block-store"
    );

    await expect(getKeySoftBlockConfig(1)).resolves.toEqual({ enabled: false, message: null });
    await expect(getKeySoftBlockConfigs([1, 2])).resolves.toEqual(new Map());
  });

  it("normalizes blank messages and only enables explicit true", async () => {
    const redis = {
      status: "ready",
      get: vi.fn(async () => JSON.stringify({ enabled: true, message: "  blocked  " })),
      mget: vi.fn(async () => [
        JSON.stringify({ enabled: true, message: "  batch  " }),
        JSON.stringify({ enabled: false, message: "ignored" }),
        "not-json",
      ]),
    };
    getRedisClient.mockReturnValue(redis);

    const { getKeySoftBlockConfig, getKeySoftBlockConfigs } = await import(
      "@/lib/key-soft-block-store"
    );

    await expect(getKeySoftBlockConfig(7)).resolves.toEqual({
      enabled: true,
      message: "blocked",
    });

    const batch = await getKeySoftBlockConfigs([7, 8, 9]);
    expect(batch.get(7)).toEqual({ enabled: true, message: "batch" });
    expect(batch.get(8)).toEqual({ enabled: false, message: "ignored" });
    expect(batch.has(9)).toBe(false);
    expect(redis.mget).toHaveBeenCalledWith(
      "cch:key-soft-block:7",
      "cch:key-soft-block:8",
      "cch:key-soft-block:9"
    );
  });

  it("returns explicit error codes when saving cannot write Redis", async () => {
    getRedisClient.mockReturnValue(null);

    const { setKeySoftBlockConfig, KEY_SOFT_BLOCK_ERROR_CODES } = await import(
      "@/lib/key-soft-block-store"
    );

    await expect(setKeySoftBlockConfig(1, { enabled: true, message: "blocked" })).resolves.toEqual({
      ok: false,
      errorCode: KEY_SOFT_BLOCK_ERROR_CODES.REDIS_UNAVAILABLE,
    });
  });

  it("persists Redis-only JSON under the soft block key", async () => {
    const redis = {
      status: "ready",
      set: vi.fn(async () => "OK"),
    };
    getRedisClient.mockReturnValue(redis);

    const { setKeySoftBlockConfig } = await import("@/lib/key-soft-block-store");

    await expect(
      setKeySoftBlockConfig(12, { enabled: true, message: "  temporary block  " })
    ).resolves.toEqual({ ok: true });

    expect(redis.set).toHaveBeenCalledWith(
      "cch:key-soft-block:12",
      JSON.stringify({ enabled: true, message: "temporary block" })
    );
  });
});
