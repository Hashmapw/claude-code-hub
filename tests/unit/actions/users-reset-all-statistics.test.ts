import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";

// Mock getSession
const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

// Mock next-intl
const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  getLocale: vi.fn(async () => "en"),
}));

// Mock next/cache
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

// Mock audit emitter to keep @/actions/users import lightweight
const emitActionAuditMock = vi.fn();
vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: (...args: unknown[]) => emitActionAuditMock(...args),
}));

// Mock repository/user with only lightweight stubs (avoid importOriginal loading full module graph)
const findUserByIdMock = vi.fn();
vi.mock("@/repository/user", () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  findUserById: findUserByIdMock,
  findUserListBatch: vi.fn(),
  getAllUserProviderGroups: vi.fn(),
  getAllUserTags: vi.fn(),
  searchUsersForFilter: vi.fn(),
  updateUser: vi.fn(),
  updateUserCostResetMarkers: vi.fn(),
}));

// Mock repository/key with only lightweight stubs (avoid importOriginal loading full module graph)
const findKeyListMock = vi.fn();
vi.mock("@/repository/key", () => ({
  createKey: vi.fn(),
  findKeyList: findKeyListMock,
  findKeyListBatch: vi.fn(),
  findKeysStatisticsBatchFromKeys: vi.fn(),
  findKeyUsageTodayBatch: vi.fn(),
}));

// Mock drizzle db
const txDeleteWhereMock = vi.fn();
const txDeleteMock = vi.fn(() => ({ where: txDeleteWhereMock }));
const txUpdateWhereMock = vi.fn();
const txUpdateSetMock = vi.fn(() => ({ where: txUpdateWhereMock }));
const txUpdateMock = vi.fn(() => ({ set: txUpdateSetMock }));
const txMock = {
  delete: txDeleteMock,
  update: txUpdateMock,
};
const dbTransactionMock = vi.fn(async (fn: (tx: typeof txMock) => Promise<void>) => {
  await fn(txMock);
});
vi.mock("@/drizzle/db", () => ({
  db: {
    transaction: dbTransactionMock,
  },
}));

// Mock logger
const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

// Mock invalidateCachedUser (called directly after transaction)
const invalidateCachedUserMock = vi.fn();
vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedUser: invalidateCachedUserMock,
}));

// Mock Redis readiness check used before dynamic cleanup import
const redisMock = {
  status: "ready",
};
const getRedisClientMock = vi.fn(() => redisMock);
vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

// Mock dynamic Redis cleanup import directly to avoid loading the real helper module tree
const clearUserCostCacheMock = vi.fn();
vi.mock("@/lib/redis/cost-cache-cleanup", () => ({
  clearUserCostCache: clearUserCostCacheMock,
}));

describe("resetUserAllStatistics", () => {
  let resetUserAllStatistics: typeof import("@/actions/users").resetUserAllStatistics;

  beforeAll(async () => {
    ({ resetUserAllStatistics } = await import("@/actions/users"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.status = "ready";
    txDeleteWhereMock.mockResolvedValue(undefined);
    txUpdateWhereMock.mockResolvedValue(undefined);
    invalidateCachedUserMock.mockResolvedValue(undefined);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 2,
      activeSessionsDeleted: 3,
      durationMs: 5,
      cleanupFailed: false,
      errorCount: 0,
    });
  });

  test("should return PERMISSION_DENIED for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  test("should return PERMISSION_DENIED when no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
  });

  test("should return NOT_FOUND for non-existent user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue(null);

    const result = await resetUserAllStatistics(999);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  test("should successfully reset all user statistics", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([
      { id: 1, key: "sk-key-1" },
      { id: 2, key: "sk-key-2" },
    ]);

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    expect(dbTransactionMock).toHaveBeenCalled();
    expect(txDeleteMock).toHaveBeenCalled();
    expect(txDeleteWhereMock).toHaveBeenCalled();
    expect(clearUserCostCacheMock).toHaveBeenCalledWith({
      userId: 123,
      keyIds: [1, 2],
      keyHashes: ["sk-key-1", "sk-key-2"],
      includeActiveSessions: true,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/users");
    expect(loggerMock.info).toHaveBeenCalled();
  });

  test("should return partial failure when Redis is not ready after DB reset", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-key-1" }]);
    clearUserCostCacheMock.mockResolvedValue(null);

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.USER_STATS_RESET_PARTIAL_FAILURE);
    expect(dbTransactionMock).toHaveBeenCalled();
    expect(clearUserCostCacheMock).toHaveBeenCalled();
  });

  test("should return partial failure when Redis has partial failures", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-key-1" }]);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 1,
      activeSessionsDeleted: 2,
      durationMs: 4,
      cleanupFailed: true,
      errorCount: 1,
    });

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.USER_STATS_RESET_PARTIAL_FAILURE);
  });

  test("should succeed with warning when no cache keys exist", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-key-1" }]);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 0,
      activeSessionsDeleted: 2,
      durationMs: 2,
      cleanupFailed: false,
      errorCount: 0,
    });

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    expect(loggerMock.info).toHaveBeenCalledWith(
      "Reset user statistics - Redis cache cleared",
      expect.objectContaining({
        userId: 123,
        keyCount: 1,
        costKeysDeleted: 0,
      })
    );
  });

  test("should return partial failure when clearUserCostCache throws", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-key-1" }]);
    clearUserCostCacheMock.mockRejectedValue(new Error("Pipeline failed"));

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.USER_STATS_RESET_PARTIAL_FAILURE);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Failed to clear Redis cache during user statistics reset",
      expect.objectContaining({ userId: 123, error: "Pipeline failed" })
    );
  });

  test("should return OPERATION_FAILED on unexpected error", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockRejectedValue(new Error("Database connection failed"));

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  test("should handle user with no keys", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([]);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 0,
      activeSessionsDeleted: 1,
      durationMs: 1,
      cleanupFailed: false,
      errorCount: 0,
    });

    const result = await resetUserAllStatistics(123);

    expect(result.ok).toBe(true);
    expect(dbTransactionMock).toHaveBeenCalled();
  });
});
