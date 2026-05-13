import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { User } from "@/types/user";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
const getLocaleMock = vi.fn(async () => "en");
const emitActionAuditMock = vi.fn();
const getKeySoftBlockConfigsMock = vi.fn(async () => new Map());
const getUnauthorizedFieldsMock = vi.fn(() => []);
const getRedisClientMock = vi.fn(() => null);
const invalidateCachedUserMock = vi.fn();
const resolveSystemTimezoneMock = vi.fn(async () => "UTC");

vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  getLocale: getLocaleMock,
}));

const findUserByIdMock = vi.fn();
const findUserListBatchMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    findUserById: findUserByIdMock,
    findUserListBatch: findUserListBatchMock,
  };
});

const findKeyListBatchMock = vi.fn();
const findKeyUsageTodayBatchMock = vi.fn();
const findKeysStatisticsBatchFromKeysMock = vi.fn();
vi.mock("@/repository/key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/key")>();
  return {
    ...actual,
    findKeyListBatch: findKeyListBatchMock,
    findKeyUsageTodayBatch: findKeyUsageTodayBatchMock,
    findKeysStatisticsBatchFromKeys: findKeysStatisticsBatchFromKeysMock,
  };
});

vi.mock("@/drizzle/db", () => ({
  db: {},
}));

vi.mock("@/drizzle/schema", () => ({
  messageRequest: {},
  usageLedger: {},
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

vi.mock("@/lib/permissions/user-field-permissions", () => ({
  getUnauthorizedFields: (...args: unknown[]) => getUnauthorizedFieldsMock(...args),
}));

vi.mock("@/lib/rate-limit/cost-reset-utils", () => ({
  clipStartByResetAt: vi.fn((start: Date) => start),
  resolveUser5hCostResetAt: vi.fn(
    (primary: Date | null, secondary: Date | null) => secondary ?? primary ?? null
  ),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: (...args: unknown[]) => getRedisClientMock(...args),
}));

vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedUser: (...args: unknown[]) => invalidateCachedUserMock(...args),
}));

vi.mock("@/lib/utils/date-input", () => ({
  parseDateInputAsTimezone: vi.fn(),
}));

vi.mock("@/lib/utils/provider-group", () => ({
  normalizeProviderGroup: vi.fn((value: unknown) => value),
  parseProviderGroups: vi.fn(() => []),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: (...args: unknown[]) => resolveSystemTimezoneMock(...args),
}));

vi.mock("@/lib/utils/validation", () => ({
  maskKey: vi.fn((value: string) => value),
}));

vi.mock("@/lib/utils/zod-i18n", () => ({
  formatZodError: vi.fn(() => "validation_error"),
}));

vi.mock("@/lib/validation/schemas", () => ({
  CreateUserSchema: {},
  UpdateUserSchema: {},
}));

function makeUser(id: number, name = `user-${id}`): User {
  return {
    id,
    name,
    description: `${name}-desc`,
    role: "user",
    rpm: null,
    dailyQuota: null,
    providerGroup: null,
    tags: [],
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    deletedAt: undefined,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    isEnabled: true,
    expiresAt: null,
    allowedClients: [],
    blockedClients: [],
    allowedModels: [],
  };
}

let getUsersAction: typeof import("@/actions/users").getUsers;
let getUsersBatchAction: typeof import("@/actions/users").getUsersBatch;

describe("getUsers compatibility", () => {
  beforeAll(async () => {
    const actions = await import("@/actions/users");
    getUsersAction = actions.getUsers;
    getUsersBatchAction = actions.getUsersBatch;
  }, 20_000);

  beforeEach(() => {
    getSessionMock.mockReset();
    findUserByIdMock.mockReset();
    findUserListBatchMock.mockReset();
    findKeyListBatchMock.mockReset();
    findKeyUsageTodayBatchMock.mockReset();
    findKeysStatisticsBatchFromKeysMock.mockReset();

    getSessionMock.mockResolvedValue({
      user: { id: 1, role: "admin" },
      key: { canLoginWebUi: true },
    });
    findKeyListBatchMock.mockResolvedValue(new Map());
    findKeyUsageTodayBatchMock.mockResolvedValue(new Map());
    findKeysStatisticsBatchFromKeysMock.mockResolvedValue(new Map());
  });

  test("loads all admin users instead of stopping at the first 50", async () => {
    const firstPageUsers = Array.from({ length: 200 }, (_, index) => makeUser(index + 1));
    const secondPageUser = makeUser(201, "after-first-200");

    findUserListBatchMock
      .mockResolvedValueOnce({
        users: firstPageUsers,
        nextCursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        users: [secondPageUser],
        nextCursor: null,
        hasMore: false,
      });

    const result = await getUsersAction();

    expect(findUserListBatchMock).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      searchTerm: undefined,
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      limit: 200,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(findUserListBatchMock).toHaveBeenNthCalledWith(2, {
      cursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
      searchTerm: undefined,
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      limit: 200,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toHaveLength(201);
    expect(result.at(-1)?.name).toBe("after-first-200");
  });

  test("normalizes legacy getUsers page and query params", async () => {
    findUserListBatchMock.mockResolvedValueOnce({
      users: [makeUser(51, "xiaolunanbei")],
      nextCursor: null,
      hasMore: false,
    });

    const result = await getUsersAction({
      page: 2,
      limit: 50,
      query: "  小鹿楠贝  ",
    });

    expect(findUserListBatchMock).toHaveBeenCalledWith({
      cursor: "50",
      limit: 50,
      searchTerm: "小鹿楠贝",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("xiaolunanbei");
  });

  test("falls back to legacy query when searchTerm is blank", async () => {
    findUserListBatchMock.mockResolvedValueOnce({
      users: [makeUser(77, "legacy-query-hit")],
      nextCursor: null,
      hasMore: false,
    });

    await getUsersBatchAction({
      searchTerm: "   ",
      query: "  alice  ",
    });

    expect(findUserListBatchMock).toHaveBeenCalledWith({
      cursor: undefined,
      limit: undefined,
      searchTerm: "alice",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
  });

  test("search-only getUsers requests keep paging until all matches are returned", async () => {
    findUserListBatchMock
      .mockResolvedValueOnce({
        users: Array.from({ length: 200 }, (_, index) => makeUser(index + 1, `match-${index + 1}`)),
        nextCursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        users: [makeUser(201, "match-201")],
        nextCursor: null,
        hasMore: false,
      });

    const result = await getUsersAction({ query: "match" });

    expect(findUserListBatchMock).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      limit: 200,
      searchTerm: "match",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(findUserListBatchMock).toHaveBeenNthCalledWith(2, {
      cursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
      limit: 200,
      searchTerm: "match",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toHaveLength(201);
    expect(result.at(-1)?.name).toBe("match-201");
  });

  test("treats whitespace cursor as missing pagination and keeps loading matches", async () => {
    findUserListBatchMock
      .mockResolvedValueOnce({
        users: Array.from({ length: 200 }, (_, index) =>
          makeUser(index + 1, `cursor-match-${index + 1}`)
        ),
        nextCursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        users: [makeUser(201, "cursor-match-201")],
        nextCursor: null,
        hasMore: false,
      });

    const result = await getUsersAction({
      cursor: "   ",
      query: "cursor-match",
    });

    expect(findUserListBatchMock).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      limit: 200,
      searchTerm: "cursor-match",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(findUserListBatchMock).toHaveBeenNthCalledWith(2, {
      cursor: '{"v":"2026-03-01T00:00:00.000Z","id":200}',
      limit: 200,
      searchTerm: "cursor-match",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toHaveLength(201);
    expect(result.at(-1)?.name).toBe("cursor-match-201");
  });

  test("normalizes legacy getUsersBatch keyword and offset params", async () => {
    findUserListBatchMock.mockResolvedValueOnce({
      users: [makeUser(88, "keyword-hit")],
      nextCursor: null,
      hasMore: false,
    });

    const { getUsersBatch } = await import("@/actions/users");

    const result = await getUsersBatch({
      offset: 75,
      limit: 25,
      keyword: "  key-word  ",
    });

    expect(findUserListBatchMock).toHaveBeenCalledWith({
      cursor: "75",
      limit: 25,
      searchTerm: "key-word",
      tagFilters: undefined,
      keyGroupFilters: undefined,
      statusFilter: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        users: [
          expect.objectContaining({
            id: 88,
            name: "keyword-hit",
          }),
        ],
        nextCursor: null,
        hasMore: false,
      },
    });
  });
});
