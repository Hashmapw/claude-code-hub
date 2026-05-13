import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  return {
    name: input.name ?? "k",
    expiresAt: input.expiresAt,
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

const createKeyMock = vi.fn(async () => ({}));
const findActiveKeyByUserIdAndNameMock = vi.fn(async () => null);
const findKeyByIdMock = vi.fn();
const findKeyListMock = vi.fn(async () => []);
const updateKeyMock = vi.fn(async () => ({}));

vi.mock("@/repository/key", () => ({
  countActiveKeysByUser: vi.fn(async () => 1),
  createKey: createKeyMock,
  deleteKey: vi.fn(async () => true),
  findActiveKeyByUserIdAndName: findActiveKeyByUserIdAndNameMock,
  findKeyById: findKeyByIdMock,
  findKeyList: findKeyListMock,
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

const syncUserProviderGroupFromKeysMock = vi.fn(async () => undefined);
vi.mock("@/actions/users", () => ({
  syncUserProviderGroupFromKeys: syncUserProviderGroupFromKeysMock,
}));

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

let addKeyAction: typeof import("@/actions/keys").addKey;
let editKeyAction: typeof import("@/actions/keys").editKey;

describe("keys limit validation", () => {
  let baseUser: Record<string, unknown>;

  beforeAll(async () => {
    const actions = await import("@/actions/keys");
    addKeyAction = actions.addKey;
    editKeyAction = actions.editKey;
  }, 20_000);

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    baseUser = {
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
      limitConcurrentSessions: 2,
      isEnabled: true,
      expiresAt: null,
      allowedClients: [],
      allowedModels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    findUserByIdMock.mockResolvedValue(baseUser);

    findKeyByIdMock.mockResolvedValue({
      id: 1,
      userId: 10,
      key: "sk-test",
      name: "k",
      isEnabled: true,
      expiresAt: null,
      canLoginWebUi: true,
      limit5hUsd: null,
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
  });

  it("addKey：key 并发超过用户并发时应拦截", async () => {
    const result = await addKeyAction({
      userId: 10,
      name: "k1",
      limitConcurrentSessions: 3,
      providerGroup: "default",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("KEY_LIMIT_CONCURRENT_EXCEEDS_USER_LIMIT");
    }
    expect(createKeyMock).not.toHaveBeenCalled();
  });

  it("addKey：用户并发为 0 时不应限制 key 并发", async () => {
    findUserByIdMock.mockResolvedValueOnce({ ...baseUser, limitConcurrentSessions: 0 });

    const result = await addKeyAction({
      userId: 10,
      name: "k1",
      limitConcurrentSessions: 3,
      providerGroup: "default",
    });

    expect(result.ok).toBe(true);
    expect(createKeyMock).toHaveBeenCalledTimes(1);
  });

  it("editKey：key 并发超过用户并发时应拦截", async () => {
    const result = await editKeyAction(1, {
      name: "k1",
      providerGroup: "default",
      limitConcurrentSessions: 3,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("KEY_LIMIT_CONCURRENT_EXCEEDS_USER_LIMIT");
    }
    expect(updateKeyMock).not.toHaveBeenCalled();
  });
});
