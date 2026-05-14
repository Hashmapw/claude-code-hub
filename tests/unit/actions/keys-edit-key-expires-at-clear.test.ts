import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
const emitActionAuditMock = vi.fn();
const getKeySoftBlockConfigsMock = vi.fn(async () => new Map());
const setKeySoftBlockConfigMock = vi.fn(async () => undefined);
const invalidateCachedKeyMock = vi.fn();
const resolveSystemTimezoneMock = vi.fn(async () => "UTC");

function parseKeyForm(value: unknown) {
  const input = (value ?? {}) as Record<string, unknown>;
  const normalizedExpiresAt =
    typeof input.expiresAt === "string" && input.expiresAt.trim() === ""
      ? undefined
      : input.expiresAt;
  return {
    name: input.name ?? "k",
    expiresAt: normalizedExpiresAt,
    canLoginWebUi: input.canLoginWebUi ?? true,
    softBlockEnabled: input.softBlockEnabled ?? false,
    softBlockMessage: input.softBlockMessage ?? null,
    limit5hUsd: input.limit5hUsd ?? null,
    limit5hResetMode: input.limit5hResetMode ?? "fixed",
    limitDailyUsd: input.limitDailyUsd ?? null,
    dailyResetMode: input.dailyResetMode ?? "fixed",
    dailyResetTime: input.dailyResetTime ?? "00:00",
    limitWeeklyUsd: input.limitWeeklyUsd ?? null,
    limitMonthlyUsd: input.limitMonthlyUsd ?? null,
    limitTotalUsd: input.limitTotalUsd ?? null,
    limitConcurrentSessions: input.limitConcurrentSessions ?? 0,
    providerGroup: input.providerGroup ?? "default",
    cacheTtlPreference: input.cacheTtlPreference ?? null,
  };
}

vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
}));

const findKeyByIdMock = vi.fn();
const updateKeyMock = vi.fn();

vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 1),
  createKey: vi.fn(async () => ({})),
  deleteKey: vi.fn(async () => true),
  findActiveKeyByUserIdAndName: vi.fn(async () => null),
  findKeyById: findKeyByIdMock,
  findKeyList: vi.fn(async () => []),
  findKeysWithStatistics: vi.fn(async () => []),
  updateKey: updateKeyMock,
}));

const findUserByIdMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
  };
});

vi.mock("@/drizzle/db", () => ({
  db: {},
}));

vi.mock("@/drizzle/schema", () => ({
  keys: {},
  users: {},
}));

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: (...args: unknown[]) => emitActionAuditMock(...args),
}));

vi.mock("@/lib/constants/provider.constants", () => ({
  PROVIDER_GROUP: {
    DEFAULT: "default",
    ALL: "all",
  },
}));

vi.mock("@/lib/key-soft-block-store", () => ({
  getKeySoftBlockConfigs: (...args: unknown[]) => getKeySoftBlockConfigsMock(...args),
  setKeySoftBlockConfig: (...args: unknown[]) => setKeySoftBlockConfigMock(...args),
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

vi.mock("@/lib/rate-limit/concurrent-session-limit", () => ({
  resolveKeyConcurrentSessionLimit: vi.fn((value: number | null | undefined) => value ?? 0),
}));

vi.mock("@/lib/rate-limit/cost-reset-utils", () => ({
  resolveKeyCostResetAt: vi.fn(() => null),
}));

vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedKey: (...args: unknown[]) => invalidateCachedKeyMock(...args),
}));

vi.mock("@/lib/utils/date-input", () => ({
  parseDateInputAsTimezone: vi.fn((value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("invalid date");
    }
    return parsed;
  }),
}));

vi.mock("@/lib/utils/provider-group", () => ({
  normalizeProviderGroup: vi.fn((value: unknown) => value),
  parseProviderGroups: vi.fn((value: string | null | undefined) =>
    value
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  ),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: (...args: unknown[]) => resolveSystemTimezoneMock(...args),
}));

vi.mock("@/lib/validation/schemas", () => ({
  KeyFormSchema: {
    parse: vi.fn((value: unknown) => parseKeyForm(value)),
    safeParse: vi.fn((value: unknown) => ({ success: true, data: parseKeyForm(value) })),
  },
}));

vi.mock("@/repository/_shared/transformers", () => ({
  toKey: vi.fn((value: unknown) => value),
}));

vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: vi.fn(async () => undefined),
}));

let editKeyAction: typeof import("@/actions/keys").editKey;

describe("editKey: expiresAt 清除/不更新语义", () => {
  beforeAll(async () => {
    ({ editKey: editKeyAction } = await import("@/actions/keys"));
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    findKeyByIdMock.mockResolvedValue({
      id: 1,
      userId: 10,
      key: "sk-test",
      name: "k",
      isEnabled: true,
      expiresAt: new Date("2026-01-04T23:59:59.999Z"),
      canLoginWebUi: true,
      limit5hUsd: null,
      limit5hResetMode: "fixed",
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 0,
      providerGroup: "default",
      cacheTtlPreference: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    findUserByIdMock.mockResolvedValue({
      id: 10,
      name: "u",
      description: "",
      role: "user",
      rpm: null,
      dailyQuota: null,
      providerGroup: "default",
      tags: [],
      limit5hUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: null,
      isEnabled: true,
      expiresAt: null,
      allowedClients: [],
      allowedModels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    updateKeyMock.mockResolvedValue({ id: 1 });
  });

  test("不携带 expiresAt 字段时不应更新 expires_at", async () => {
    const res = await editKeyAction(1, { name: "k2" });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);

    const updatePayload = updateKeyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(updatePayload, "expires_at")).toBe(false);
  });

  test("携带 expiresAt=undefined 时应清除 expires_at（写入 null）", async () => {
    const res = await editKeyAction(1, { name: "k2", expiresAt: undefined });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);
    expect(updateKeyMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        expires_at: null,
      })
    );
  });

  test('携带 expiresAt="" 时应清除 expires_at（写入 null）', async () => {
    const res = await editKeyAction(1, { name: "k2", expiresAt: "" });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);
    expect(updateKeyMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        expires_at: null,
      })
    );
  });

  test("携带 expiresAt=YYYY-MM-DD 时应写入对应 Date", async () => {
    const res = await editKeyAction(1, { name: "k2", expiresAt: "2026-01-04" });

    expect(res.ok).toBe(true);
    expect(updateKeyMock).toHaveBeenCalledTimes(1);

    const updatePayload = updateKeyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updatePayload.expires_at).toBeInstanceOf(Date);
    expect(Number.isNaN((updatePayload.expires_at as Date).getTime())).toBe(false);
  });

  test("携带非法 expiresAt 字符串应返回 INVALID_FORMAT", async () => {
    const res = await editKeyAction(1, { name: "k2", expiresAt: "not-a-date" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe("INVALID_FORMAT");
    }
  });
});
