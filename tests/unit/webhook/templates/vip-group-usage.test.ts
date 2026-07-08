import { describe, expect, it } from "vitest";
import { buildTemplateVariables } from "@/lib/webhook/templates/placeholders";
import { buildVipGroupUsageMessage } from "@/lib/webhook/templates/vip-group-usage";

describe("VIP group usage webhook template", () => {
  it("renders provider group as provider data, not key group data", () => {
    const message = buildVipGroupUsageMessage(
      {
        userId: 1,
        userName: "alice",
        providerId: 2,
        providerName: "vip-provider",
        providerGroupTag: "vip,expensive",
        model: "claude-sonnet-4-5",
        sessionId: "session-1",
        timestamp: "2026-06-15T00:00:00.000Z",
      },
      "UTC"
    );

    expect(message.header.title).toBe("高成本分组使用提醒");
    expect(JSON.stringify(message.sections)).toContain("vip,expensive");
    expect(JSON.stringify(message.sections)).toContain("vip-provider");
  });

  it("exposes all placeholders used by the default template", () => {
    const data = {
      userId: 1,
      userName: "alice",
      providerId: 2,
      providerName: "vip-provider",
      providerGroupTag: "vip",
      model: "claude-sonnet-4-5",
      sessionId: "session-1",
      timestamp: "2026-06-15T00:00:00.000Z",
    };
    const variables = buildTemplateVariables({
      message: buildVipGroupUsageMessage(data, "UTC"),
      notificationType: "vip_group_usage",
      data,
      timezone: "UTC",
    });

    expect(variables).toMatchObject({
      "{{user_id}}": "1",
      "{{user_name}}": "alice",
      "{{provider_id}}": "2",
      "{{provider_name}}": "vip-provider",
      "{{provider_group_tag}}": "vip",
      "{{model}}": "claude-sonnet-4-5",
      "{{session_id}}": "session-1",
    });
  });
});
