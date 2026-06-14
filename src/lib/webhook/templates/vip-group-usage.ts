import type { StructuredMessage, VipGroupUsageData } from "../types";
import { formatDateTime } from "../utils/date";

export function buildVipGroupUsageMessage(
  data: VipGroupUsageData,
  timezone?: string
): StructuredMessage {
  const fields = [
    { label: "供应商 ID", value: String(data.providerId) },
    { label: "供应商名称", value: data.providerName },
    { label: "供应商分组", value: data.providerGroupTag },
    { label: "用户 ID", value: String(data.userId) },
    { label: "用户名", value: data.userName },
    { label: "模型", value: data.model },
    { label: "会话 ID", value: data.sessionId },
    { label: "时间", value: formatDateTime(data.timestamp, timezone || "UTC") },
  ];

  return {
    header: {
      title: "高成本分组使用提醒",
      level: "warning",
    },
    sections: [
      {
        content: [
          {
            type: "quote",
            value: `用户 ${data.userName} 调用了 VIP 供应商「${data.providerName}」`,
          },
        ],
      },
      {
        title: "详情",
        content: [{ type: "fields", items: fields }],
      },
    ],
    timestamp: new Date(),
  };
}
