import { beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

const getTranslationsMock = vi.fn(async () => (key: string) => key);
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  getLocale: vi.fn(async () => "en"),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const findUserByIdMock = vi.fn();
const updateUserCostResetMarkersMock = vi.fn();
vi.mock("@/repository/user", () => ({
  findUserById: findUserByIdMock,
  updateUserCostResetMarkers: updateUserCostResetMarkersMock,
}));

const findKeyListMock = vi.fn();
vi.mock("@/repository/key", () => ({
  findKeyList: findKeyListMock,
}));

const clearUserCostCacheMock = vi.fn();
vi.mock("@/lib/redis/cost-cache-cleanup", () => ({
  clearUserCostCache: clearUserCostCacheMock,
}));

const dbDeleteWhereMock = vi.fn();
const dbDeleteMock = vi.fn(() => ({ where: dbDeleteWhereMock }));
vi.mock("@/drizzle/db", () => ({
  db: {
    delete: dbDeleteMock,
  },
}));

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

const redisMock = {
  status: "ready",
};
const getRedisClientMock = vi.fn(() => redisMock);
vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

vi.mock("@/lib/audit/emit", () => ({
  emitActionAudit: vi.fn(),
}));

vi.mock("@/lib/key-soft-block-store", () => ({
  getKeySoftBlockConfigs: vi.fn(),
}));

vi.mock("@/lib/security/api-key-auth-cache", () => ({
  invalidateCachedUser: vi.fn(),
}));

describe("resetUserLimitsOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.status = "ready";
    updateUserCostResetMarkersMock.mockResolvedValue(true);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 0,
      leaseKeysDeleted: 0,
      activeSessionKeysDeleted: 0,
      cleanupFailed: false,
      durationMs: 1,
    });
  });

  test("should return PERMISSION_DENIED for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  test("should return PERMISSION_DENIED when no session", async () => {
    getSessionMock.mockResolvedValue(null);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
  });

  test("should return NOT_FOUND for non-existent user", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue(null);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(999);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    expect(updateUserCostResetMarkersMock).not.toHaveBeenCalled();
  });

  test("should set costResetAt and clear Redis cost cache", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([
      { id: 1, key: "sk-hash-1" },
      { id: 2, key: "sk-hash-2" },
    ]);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        costResetAt: expect.any(Date),
        limit5hCostResetAt: expect.any(Date),
      })
    );
    expect(clearUserCostCacheMock).toHaveBeenCalledWith({
      userId: 123,
      keyIds: [1, 2],
      keyHashes: ["sk-hash-1", "sk-hash-2"],
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/users");
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  test("should return partial failure when fixed 5h cleanup fails after DB markers advance", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "fixed",
    });
    findKeyListMock.mockResolvedValue([]);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 0,
      leaseKeysDeleted: 0,
      activeSessionKeysDeleted: 0,
      cleanupFailed: true,
      durationMs: 1,
    });

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.USER_LIMITS_RESET_PARTIAL_FAILURE);
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        costResetAt: expect.any(Date),
        limit5hCostResetAt: expect.any(Date),
      })
    );
  });

  test("should NOT delete messageRequest or usageLedger rows", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    await resetUserLimitsOnly(123);

    expect(dbDeleteMock).not.toHaveBeenCalled();
    expect(dbDeleteWhereMock).not.toHaveBeenCalled();
  });

  test("should succeed when Redis is not ready", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);
    redisMock.status = "connecting";

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        costResetAt: expect.any(Date),
        limit5hCostResetAt: expect.any(Date),
      })
    );
    expect(clearUserCostCacheMock).toHaveBeenCalledWith({
      userId: 123,
      keyIds: [1],
      keyHashes: ["sk-hash-1"],
    });
  });

  test("should succeed with warning when Redis cleanup reports partial failures", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);
    clearUserCostCacheMock.mockResolvedValue({
      costKeysDeleted: 1,
      leaseKeysDeleted: 0,
      activeSessionKeysDeleted: 0,
      cleanupFailed: true,
      durationMs: 1,
    });

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(loggerMock.info).toHaveBeenCalledWith(
      "Reset user limits only - Redis cost cache cleared",
      expect.objectContaining({
        userId: 123,
        cleanupFailed: true,
      })
    );
  });

  test("should succeed when clearUserCostCache throws for non-fixed reset", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([{ id: 1, key: "sk-hash-1" }]);
    clearUserCostCacheMock.mockRejectedValue(new Error("Pipeline failed"));

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "Failed to clear Redis cache during user limits reset",
      expect.objectContaining({ userId: 123, error: "Pipeline failed" })
    );
  });

  test("should return OPERATION_FAILED on unexpected error", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockRejectedValue(new Error("Database connection failed"));

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  test("should handle user with no keys", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({ id: 123, name: "Test User" });
    findKeyListMock.mockResolvedValue([]);

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(true);
    expect(updateUserCostResetMarkersMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        costResetAt: expect.any(Date),
        limit5hCostResetAt: expect.any(Date),
      })
    );
    expect(clearUserCostCacheMock).toHaveBeenCalledWith({
      userId: 123,
      keyIds: [],
      keyHashes: [],
    });
    expect(dbDeleteMock).not.toHaveBeenCalled();
  });

  test("should fail when a fixed 5h limit exists and Redis is not ready", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: 5,
      limit5hResetMode: "fixed",
    });
    findKeyListMock.mockResolvedValue([]);
    redisMock.status = "connecting";

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(updateUserCostResetMarkersMock).not.toHaveBeenCalled();
    expect(clearUserCostCacheMock).not.toHaveBeenCalled();
  });

  test("should fail when a child key has fixed 5h limit and Redis is not ready", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUserByIdMock.mockResolvedValue({
      id: 123,
      name: "Test User",
      limit5hUsd: null,
      limit5hResetMode: "rolling",
    });
    findKeyListMock.mockResolvedValue([
      {
        id: 11,
        key: "sk-child-11",
        limit5hUsd: 2,
        limit5hResetMode: "fixed",
      },
    ]);
    redisMock.status = "connecting";

    const { resetUserLimitsOnly } = await import("@/actions/users");
    const result = await resetUserLimitsOnly(123);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.OPERATION_FAILED);
    expect(updateUserCostResetMarkersMock).not.toHaveBeenCalled();
    expect(clearUserCostCacheMock).not.toHaveBeenCalled();
  });
});
