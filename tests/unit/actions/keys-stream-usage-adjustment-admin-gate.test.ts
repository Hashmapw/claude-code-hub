import { beforeEach, describe, expect, it, vi } from "vitest";

// streamUsageAdjustment 是 admin-only 字段：会改写流式 token 用量并直接影响计费 / 配额，
// 因此非 admin 不得设置 / 修改。本测试锁定服务端 editKey 的权限闸门，防止回归。

const getSessionMock = vi.fn();
const findKeyByIdMock = vi.fn();
const updateKeyMock = vi.fn();
const findUserByIdMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => getSessionMock() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/audit/emit", () => ({ emitActionAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/drizzle/db", () => ({ db: {} }));
vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 2),
  createKey: vi.fn(),
  deleteKey: vi.fn(),
  findActiveKeyByUserIdAndName: vi.fn(async () => null),
  findKeyById: (...args: unknown[]) => findKeyByIdMock(...args),
  findKeyList: vi.fn(async () => []),
  findKeysWithStatistics: vi.fn(),
  resetKeyCostResetAt: vi.fn(),
  updateKey: (...args: unknown[]) => updateKeyMock(...args),
}));
vi.mock("@/repository/user", () => ({
  findUserById: (...args: unknown[]) => findUserByIdMock(...args),
}));
vi.mock("@/lib/key-soft-block-store", () => ({
  getKeySoftBlockConfigs: vi.fn(async () => ({})),
  setKeySoftBlockConfig: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedKey: vi.fn(async () => null),
}));
vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: vi.fn(async () => {}),
}));
vi.mock("@/lib/redis/cost-cache-cleanup", () => ({
  clearSingleKeyCostCache: vi.fn(async () => {}),
}));

const { editKey } = await import("@/actions/keys");

const ADJUSTMENT_PAYLOAD = {
  name: "my-key",
  streamUsageAdjustmentEnabled: true,
  streamUsageAdjustmentProbability: 100,
  streamUsageAdjustmentInputTokensRatio: 0,
  streamUsageAdjustmentOutputTokensRatio: 0,
  streamUsageAdjustmentCacheReadInputTokensRatio: 0,
  streamUsageAdjustmentCacheCreationInputTokensRatio: 0,
};

describe("editKey streamUsageAdjustment admin gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findKeyByIdMock.mockResolvedValue({
      id: 50,
      userId: 2,
      providerGroup: "default",
      isEnabled: true,
      key: "khash",
      name: "my-key",
    });
    findUserByIdMock.mockResolvedValue({ id: 2, limit5hUsd: null, dailyQuota: null });
    updateKeyMock.mockResolvedValue(undefined);
  });

  it("ignores streamUsageAdjustment when a non-admin edits their own key", async () => {
    getSessionMock.mockReturnValue({
      user: { id: 2, role: "user" },
      key: { id: 2, userId: 2, key: "user-token", canLoginWebUi: true },
    });

    const result = await editKey(50, ADJUSTMENT_PAYLOAD);

    expect(result.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);
    const updatePayload = updateKeyMock.mock.calls[0][1] as Record<string, unknown>;
    // 安全断言：非 admin 的改写被静默忽略，DB 写入不含 stream_usage_adjustment。
    expect(updatePayload).not.toHaveProperty("stream_usage_adjustment");
  });

  it("applies streamUsageAdjustment when an admin edits the key", async () => {
    getSessionMock.mockReturnValue({
      user: { id: 1, role: "admin" },
      key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
    });

    const result = await editKey(50, ADJUSTMENT_PAYLOAD);

    expect(result.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);
    const updatePayload = updateKeyMock.mock.calls[0][1] as Record<string, unknown>;
    expect(updatePayload.stream_usage_adjustment).toMatchObject({
      enabled: true,
      inputTokensRatio: 0,
      outputTokensRatio: 0,
      cacheReadInputTokensRatio: 0,
      cacheCreationInputTokensRatio: 0,
    });
  });
});
