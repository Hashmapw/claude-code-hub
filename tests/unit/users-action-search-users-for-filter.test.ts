import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

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

const searchUsersForFilterRepositoryMock = vi.fn();
const createUserMock = vi.fn();
const deleteUserMock = vi.fn();
const findUserByIdMock = vi.fn();
const findUserListBatchMock = vi.fn();
const getAllUserProviderGroupsRepositoryMock = vi.fn();
const getAllUserTagsRepositoryMock = vi.fn();
const updateUserMock = vi.fn();
const updateUserCostResetMarkersMock = vi.fn();
vi.mock("@/repository/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/user")>();
  return {
    ...actual,
    createUser: (...args: unknown[]) => createUserMock(...args),
    deleteUser: (...args: unknown[]) => deleteUserMock(...args),
    findUserById: (...args: unknown[]) => findUserByIdMock(...args),
    findUserListBatch: (...args: unknown[]) => findUserListBatchMock(...args),
    getAllUserProviderGroups: (...args: unknown[]) =>
      getAllUserProviderGroupsRepositoryMock(...args),
    getAllUserTags: (...args: unknown[]) => getAllUserTagsRepositoryMock(...args),
    searchUsersForFilter: searchUsersForFilterRepositoryMock,
    updateUser: (...args: unknown[]) => updateUserMock(...args),
    updateUserCostResetMarkers: (...args: unknown[]) => updateUserCostResetMarkersMock(...args),
  };
});

vi.mock("@/repository/key", () => ({
  createKey: vi.fn(),
  findKeyList: vi.fn(),
  findKeyListBatch: vi.fn(),
  findKeysStatisticsBatchFromKeys: vi.fn(),
  findKeyUsageTodayBatch: vi.fn(),
}));

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

let searchUsersForFilterAction: typeof import("@/actions/users").searchUsersForFilter;
let searchUsersAction: typeof import("@/actions/users").searchUsers;

describe("searchUsersForFilter (action)", () => {
  beforeAll(async () => {
    const actions = await import("@/actions/users");
    searchUsersForFilterAction = actions.searchUsersForFilter;
    searchUsersAction = actions.searchUsers;
  }, 20_000);

  beforeEach(() => {
    getSessionMock.mockReset();
    searchUsersForFilterRepositoryMock.mockReset();
  });

  test("returns UNAUTHORIZED when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await searchUsersForFilterAction();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("UNAUTHORIZED");
    }
  });

  test("returns PERMISSION_DENIED for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 123, role: "user" } });

    const result = await searchUsersForFilterAction();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("PERMISSION_DENIED");
    }
  });

  test("returns users for admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    searchUsersForFilterRepositoryMock.mockResolvedValue([{ id: 1, name: "Alice" }]);

    const result = await searchUsersForFilterAction("ali");

    expect(searchUsersForFilterRepositoryMock).toHaveBeenCalledWith("ali", undefined);
    expect(result).toEqual({ ok: true, data: [{ id: 1, name: "Alice" }] });
  });

  test("searchUsers alias delegates to searchUsersForFilter", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    searchUsersForFilterRepositoryMock.mockResolvedValue([{ id: 9, name: "Bob" }]);

    const result = await searchUsersAction("bob");

    expect(searchUsersForFilterRepositoryMock).toHaveBeenCalledWith("bob", undefined);
    expect(result).toEqual({ ok: true, data: [{ id: 9, name: "Bob" }] });
  });
});
