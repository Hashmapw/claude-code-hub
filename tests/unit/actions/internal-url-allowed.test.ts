import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn(async () => ({ user: { role: "admin" } }));
const createWebhookTargetMock = vi.fn(async (input: any) => ({ id: 1, ...input }));
const resolveSystemTimezoneMock = vi.fn(async () => "UTC");
const buildTestMessageMock = vi.fn(() => ({
  title: "test",
  description: "test",
  level: "info" as const,
  sections: [],
}));

vi.mock("@/lib/auth", () => {
  return {
    getSession: getSessionMock,
  };
});

vi.mock("@/repository/notifications", () => {
  return {
    getNotificationSettings: vi.fn(async () => ({ useLegacyMode: false })),
    updateNotificationSettings: vi.fn(async () => ({})),
  };
});

vi.mock("@/repository/webhook-targets", () => {
  return {
    createWebhookTarget: createWebhookTargetMock,
    deleteWebhookTarget: vi.fn(async () => {}),
    getAllWebhookTargets: vi.fn(async () => []),
    getWebhookTargetById: vi.fn(async () => null),
    updateTestResult: vi.fn(async () => {}),
    updateWebhookTarget: vi.fn(async () => ({})),
  };
});

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: (...args: unknown[]) => resolveSystemTimezoneMock(...args),
}));

vi.mock("@/lib/webhook/templates/test-messages", () => ({
  buildTestMessage: (...args: unknown[]) => buildTestMessageMock(...args),
}));

vi.mock("@/lib/webhook", () => ({
  WebhookNotifier: class MockWebhookNotifier {
    constructor(target: string) {
      const hostname = new URL(target).hostname;
      if (hostname !== "qyapi.weixin.qq.com" && hostname !== "open.feishu.cn") {
        throw new Error(`Unsupported webhook hostname: ${hostname}`);
      }
    }

    async send() {
      return { success: true };
    }
  },
}));

describe("允许内网地址输入", () => {
  let testWebhookAction: typeof import("@/actions/notifications").testWebhookAction;
  let createWebhookTargetAction: typeof import("@/actions/webhook-targets").createWebhookTargetAction;

  beforeAll(async () => {
    const [notificationActions, webhookTargetActions] = await Promise.all([
      import("@/actions/notifications"),
      import("@/actions/webhook-targets"),
    ]);
    testWebhookAction = notificationActions.testWebhookAction;
    createWebhookTargetAction = webhookTargetActions.createWebhookTargetAction;
  }, 20_000);

  beforeEach(() => {
    vi.clearAllMocks();

    // 默认：管理员可执行
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });
    createWebhookTargetMock.mockImplementation(async (input: any) => ({ id: 1, ...input }));
  });

  test("testWebhookAction 不阻止内网 URL（但会因 hostname 不支持而失败）", async () => {
    // 该用例验证：输入层允许内网 IP（不会被拦截），但 provider 检测会因 hostname 不受支持而失败
    const result = await testWebhookAction("http://127.0.0.1:8080/webhook", "cost-alert");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported webhook hostname");
  });

  test("testWebhookAction 非管理员应被拒绝", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { role: "user" } });

    const result = await testWebhookAction("http://127.0.0.1:8080/webhook", "cost-alert");

    expect(result.success).toBe(false);
    expect(result.error).toBe("无权限执行此操作");
  });

  test("createWebhookTargetAction 允许内网 webhookUrl", async () => {
    const internalUrl = "http://127.0.0.1:8080/webhook";

    const result = await createWebhookTargetAction({
      name: "test-target",
      providerType: "wechat",
      webhookUrl: internalUrl,
      isEnabled: true,
    });

    expect(result.ok).toBe(true);
    expect(createWebhookTargetMock).toHaveBeenCalledTimes(1);
    expect(createWebhookTargetMock.mock.calls[0]?.[0]?.webhookUrl).toBe(internalUrl);
  });
});
