import { beforeEach, describe, expect, it, vi } from "vitest";

const getKeySoftBlockConfig = vi.hoisted(() => vi.fn());
const storeSessionSpecialSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/key-soft-block-store", () => ({
  getKeySoftBlockConfig,
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    generateSessionId: vi.fn(() => "generated-session"),
    storeSessionSpecialSettings,
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/utils/error-messages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/error-messages")>(
    "@/lib/utils/error-messages"
  );
  return {
    ...actual,
    getErrorMessageServer: vi.fn(async (_locale: string, code: string) => code),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeSession() {
  const specialSettings: unknown[] = [];
  return {
    sessionId: null as string | null,
    authState: {
      user: { id: 1, name: "alice" },
      key: { id: 9, name: "soft-blocked-key" },
    },
    setSessionId(value: string) {
      this.sessionId = value;
    },
    addSpecialSetting(value: unknown) {
      specialSettings.push(value);
    },
    getSpecialSettings() {
      return specialSettings;
    },
    getRequestSequence() {
      return 1;
    },
  };
}

describe("key soft block proxy helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getKeySoftBlockConfig.mockResolvedValue({ enabled: false, message: null });
    storeSessionSpecialSettings.mockResolvedValue(undefined);
  });

  it("does nothing when the runtime config is disabled", async () => {
    const { handleKeySoftBlock } = await import("@/app/v1/_lib/proxy/key-soft-block");

    await expect(handleKeySoftBlock(makeSession() as never)).resolves.toBeNull();
    expect(storeSessionSpecialSettings).not.toHaveBeenCalled();
  });

  it("returns a 401 user_disabled response and records the guard intercept setting", async () => {
    getKeySoftBlockConfig.mockResolvedValue({ enabled: true, message: "  contact admin  " });

    const { handleKeySoftBlock } = await import("@/app/v1/_lib/proxy/key-soft-block");
    const session = makeSession();
    const response = await handleKeySoftBlock(session as never);

    expect(response?.status).toBe(401);
    const body = (await response?.json()) as { error: { type: string; message: string } };
    expect(body.error).toMatchObject({ type: "user_disabled", message: "contact admin" });
    expect(session.sessionId).toBe("generated-session");
    expect(storeSessionSpecialSettings).toHaveBeenCalledWith(
      "generated-session",
      [
        expect.objectContaining({
          type: "guard_intercept",
          guard: "key_soft_block",
          action: "block_request",
          statusCode: 401,
        }),
      ],
      1
    );
  });

  it("uses the localized fallback message when no custom message is configured", async () => {
    getKeySoftBlockConfig.mockResolvedValue({ enabled: true, message: "   " });

    const { handleKeySoftBlock } = await import("@/app/v1/_lib/proxy/key-soft-block");
    const response = await handleKeySoftBlock(makeSession() as never);

    const body = (await response?.json()) as { error: { message: string } };
    expect(body.error.message).toBe("PROXY_KEY_SOFT_BLOCKED");
  });
});
