import { beforeEach, describe, expect, test, vi } from "vitest";

const generateSessionIdMock = vi.fn(() => "sess_soft_block");
const storeSessionSpecialSettingsMock = vi.fn(async () => {});
const getKeySoftBlockConfigMock = vi.fn(async () => ({ enabled: false, message: null }));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    generateSessionId: generateSessionIdMock,
    storeSessionSpecialSettings: storeSessionSpecialSettingsMock,
  },
}));
vi.mock("@/lib/key-soft-block-store", () => ({
  getKeySoftBlockConfig: getKeySoftBlockConfigMock,
}));

describe("key soft block helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("soft block disabled should allow request", async () => {
    const { handleKeySoftBlock } = await import("@/app/v1/_lib/proxy/key-soft-block");

    const session = {
      authState: {
        success: true,
        user: { id: 1 },
        key: { id: 2 },
        apiKey: "sk-test",
      },
      sessionId: null,
      setSessionId: vi.fn(),
      addSpecialSetting: vi.fn(),
      getSpecialSettings: vi.fn(() => null),
      getRequestSequence: vi.fn(() => 1),
    } as any;

    await expect(handleKeySoftBlock(session)).resolves.toBeNull();
    expect(storeSessionSpecialSettingsMock).not.toHaveBeenCalled();
  });

  test("soft block enabled should return 401 and persist guard intercept settings", async () => {
    const { handleKeySoftBlock } = await import("@/app/v1/_lib/proxy/key-soft-block");
    getKeySoftBlockConfigMock.mockResolvedValue({
      enabled: true,
      message: "Blocked by administrator",
    });

    const state: { settings: unknown[] } = { settings: [] };
    const session = {
      authState: {
        success: true,
        user: { id: 1 },
        key: { id: 2 },
        apiKey: "sk-test",
      },
      sessionId: null,
      setSessionId(id: string) {
        this.sessionId = id;
      },
      addSpecialSetting(setting: unknown) {
        state.settings.push(setting);
      },
      getSpecialSettings() {
        return state.settings;
      },
      getRequestSequence() {
        return 1;
      },
    } as any;

    const response = await handleKeySoftBlock(session);

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: {
        message: "Blocked by administrator",
        type: "user_disabled",
        code: "user_disabled",
      },
    });
    expect(generateSessionIdMock).toHaveBeenCalledTimes(1);
    expect(storeSessionSpecialSettingsMock).toHaveBeenCalledWith(
      "sess_soft_block",
      expect.arrayContaining([
        expect.objectContaining({
          type: "guard_intercept",
          guard: "key_soft_block",
          statusCode: 401,
        }),
      ]),
      1
    );
  });
});
