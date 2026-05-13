import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/config/config", () => ({
  config: {
    auth: {
      adminToken: undefined,
    },
  },
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({
    SESSION_TOKEN_MODE:
      (process.env.SESSION_TOKEN_MODE as "legacy" | "dual" | "opaque" | undefined) ?? "opaque",
  }),
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

vi.mock("@/lib/security/constant-time-compare", () => ({
  constantTimeEqual: vi.fn(() => false),
}));

vi.mock("@/repository/key", () => ({
  findKeyList: vi.fn(),
  validateApiKeyAndGetUser: vi.fn(),
}));

const ORIGINAL_SESSION_TOKEN_MODE = process.env.SESSION_TOKEN_MODE;
const {
  getSessionTokenMode,
  getSessionTokenMigrationFlags,
  isOpaqueSessionContract,
  isSessionTokenAccepted,
} = await import("@/lib/auth");

function restoreSessionTokenModeEnv() {
  if (ORIGINAL_SESSION_TOKEN_MODE === undefined) {
    delete process.env.SESSION_TOKEN_MODE;
    return;
  }
  process.env.SESSION_TOKEN_MODE = ORIGINAL_SESSION_TOKEN_MODE;
}

describe("session token contract and migration flags", () => {
  afterEach(() => {
    restoreSessionTokenModeEnv();
    vi.clearAllMocks();
  });

  it("SESSION_TOKEN_MODE defaults to opaque", () => {
    delete process.env.SESSION_TOKEN_MODE;

    expect(getSessionTokenMode()).toBe("opaque");
  });

  it("getSessionTokenMode returns configured mode values", () => {
    const modes = ["legacy", "dual", "opaque"] as const;

    for (const mode of modes) {
      process.env.SESSION_TOKEN_MODE = mode;

      expect(getSessionTokenMode()).toBe(mode);
    }
  });

  it("validates OpaqueSessionContract runtime shape strictly", () => {
    const validContract = {
      sessionId: "sid_opaque_session_123",
      keyFingerprint: "sha256:abc123",
      createdAt: 1_700_000_000,
      expiresAt: 1_700_000_300,
      userId: 42,
      userRole: "admin",
    };

    expect(isOpaqueSessionContract(validContract)).toBe(true);
    expect(
      isOpaqueSessionContract({
        ...validContract,
        keyFingerprint: "",
      })
    ).toBe(false);
    expect(
      isOpaqueSessionContract({
        ...validContract,
        expiresAt: validContract.createdAt,
      })
    ).toBe(false);
    expect(
      isOpaqueSessionContract({
        ...validContract,
        userId: 3.14,
      })
    ).toBe(false);
  });

  it("accepts both legacy cookie and opaque session in dual mode", () => {
    process.env.SESSION_TOKEN_MODE = "dual";

    const mode = getSessionTokenMode();
    expect(mode).toBe("dual");
    expect(getSessionTokenMigrationFlags(mode)).toEqual({
      dualReadWindowEnabled: true,
      hardCutoverEnabled: false,
      emergencyRollbackEnabled: false,
    });

    expect(isSessionTokenAccepted("sk-legacy-cookie", mode)).toBe(true);
    expect(isSessionTokenAccepted("sid_opaque_session_cookie", mode)).toBe(true);
  });

  it("accepts only legacy cookie in legacy mode", () => {
    process.env.SESSION_TOKEN_MODE = "legacy";

    const mode = getSessionTokenMode();
    expect(mode).toBe("legacy");
    expect(getSessionTokenMigrationFlags(mode)).toEqual({
      dualReadWindowEnabled: false,
      hardCutoverEnabled: false,
      emergencyRollbackEnabled: true,
    });

    expect(isSessionTokenAccepted("sk-legacy-cookie", mode)).toBe(true);
    expect(isSessionTokenAccepted("sid_opaque_session_cookie", mode)).toBe(false);
  });
});
