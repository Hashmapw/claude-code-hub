import { beforeEach, describe, expect, it, vi } from "vitest";

const sendVipGroupUsageAlert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notification/notifier", () => ({
  sendVipGroupUsageAlert,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    request: { model: "redirected-model" },
    headers: new Headers(),
    getOriginalModel: () => "original-model",
    messageContext: { user: { id: 1, name: "alice" } },
    authState: { user: { id: 2, name: "bob" } },
    ...overrides,
  };
}

describe("VIP group usage proxy hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendVipGroupUsageAlert.mockResolvedValue(undefined);
  });

  it("matches only an exact vip provider group token", async () => {
    const { hasVipProviderGroup } = await import("@/app/v1/_lib/proxy/vip-group-usage");

    expect(hasVipProviderGroup("default,vip")).toBe(true);
    expect(hasVipProviderGroup("VIP")).toBe(true);
    expect(hasVipProviderGroup("notvip")).toBe(false);
    expect(hasVipProviderGroup(null)).toBe(false);
  });

  it("enqueues a best-effort alert with provider group and original model", async () => {
    const { maybeSendVipGroupUsageAlert } = await import("@/app/v1/_lib/proxy/vip-group-usage");

    await maybeSendVipGroupUsageAlert(makeSession() as never, {
      id: 10,
      name: "vip-provider",
      groupTag: "default,vip",
    });

    expect(sendVipGroupUsageAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        userName: "alice",
        providerId: 10,
        providerName: "vip-provider",
        providerGroupTag: "default,vip",
        model: "original-model",
        sessionId: "session-1",
      })
    );
  });

  it("skips non-vip providers and missing user context", async () => {
    const { maybeSendVipGroupUsageAlert } = await import("@/app/v1/_lib/proxy/vip-group-usage");

    await maybeSendVipGroupUsageAlert(makeSession() as never, {
      id: 10,
      name: "regular-provider",
      groupTag: "default",
    });
    await maybeSendVipGroupUsageAlert(
      makeSession({ messageContext: null, authState: null }) as never,
      {
        id: 11,
        name: "vip-provider",
        groupTag: "vip",
      }
    );

    expect(sendVipGroupUsageAlert).not.toHaveBeenCalled();
  });
});
