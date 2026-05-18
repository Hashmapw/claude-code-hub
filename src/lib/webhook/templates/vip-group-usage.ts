import type { StructuredMessage, VipGroupUsageData } from "../types";
import { formatDateTime } from "../utils/date";

type VipGroupUsageLocale = "zh-CN" | "zh-TW" | "en" | "ja" | "ru";

const VIP_GROUP_USAGE_I18N: Record<
  VipGroupUsageLocale,
  {
    title: string;
    details: string;
    fields: {
      providerId: string;
      providerName: string;
      providerGroup: string;
      userId: string;
      userName: string;
      model: string;
      sessionId: string;
      time: string;
    };
    quote: (data: VipGroupUsageData) => string;
  }
> = {
  "zh-CN": {
    title: "高成本分组使用提醒",
    details: "详情",
    fields: {
      providerId: "供应商 ID",
      providerName: "供应商名称",
      providerGroup: "供应商分组",
      userId: "用户 ID",
      userName: "用户名",
      model: "模型",
      sessionId: "会话 ID",
      time: "时间",
    },
    quote: (data) => `用户 ${data.userName} 调用了 VIP 供应商「${data.providerName}」`,
  },
  "zh-TW": {
    title: "高成本分組使用提醒",
    details: "詳情",
    fields: {
      providerId: "供應商 ID",
      providerName: "供應商名稱",
      providerGroup: "供應商分組",
      userId: "使用者 ID",
      userName: "使用者名稱",
      model: "模型",
      sessionId: "會話 ID",
      time: "時間",
    },
    quote: (data) => `使用者 ${data.userName} 呼叫了 VIP 供應商「${data.providerName}」`,
  },
  en: {
    title: "High-cost group usage alert",
    details: "Details",
    fields: {
      providerId: "Provider ID",
      providerName: "Provider name",
      providerGroup: "Provider group",
      userId: "User ID",
      userName: "User name",
      model: "Model",
      sessionId: "Session ID",
      time: "Time",
    },
    quote: (data) => `User ${data.userName} used VIP provider ${data.providerName}`,
  },
  ja: {
    title: "高コストグループ使用アラート",
    details: "詳細",
    fields: {
      providerId: "プロバイダー ID",
      providerName: "プロバイダー名",
      providerGroup: "プロバイダーグループ",
      userId: "ユーザー ID",
      userName: "ユーザー名",
      model: "モデル",
      sessionId: "セッション ID",
      time: "時刻",
    },
    quote: (data) =>
      `ユーザー ${data.userName} が VIP プロバイダー ${data.providerName} を使用しました`,
  },
  ru: {
    title: "Оповещение об использовании дорогой группы",
    details: "Сведения",
    fields: {
      providerId: "ID провайдера",
      providerName: "Название провайдера",
      providerGroup: "Группа провайдера",
      userId: "ID пользователя",
      userName: "Имя пользователя",
      model: "Модель",
      sessionId: "ID сессии",
      time: "Время",
    },
    quote: (data) =>
      `Пользователь ${data.userName} использовал VIP-провайдера ${data.providerName}`,
  },
};

function resolveLocale(locale?: string): VipGroupUsageLocale {
  return locale === "zh-TW" || locale === "en" || locale === "ja" || locale === "ru"
    ? locale
    : "zh-CN";
}

export function buildVipGroupUsageMessage(
  data: VipGroupUsageData,
  timezone?: string,
  locale?: string
): StructuredMessage {
  const copy = VIP_GROUP_USAGE_I18N[resolveLocale(locale)];
  const fields = [
    { label: copy.fields.providerId, value: String(data.providerId) },
    { label: copy.fields.providerName, value: data.providerName },
    { label: copy.fields.providerGroup, value: data.providerGroupTag },
    { label: copy.fields.userId, value: String(data.userId) },
    { label: copy.fields.userName, value: data.userName },
    { label: copy.fields.model, value: data.model },
    { label: copy.fields.sessionId, value: data.sessionId },
    { label: copy.fields.time, value: formatDateTime(data.timestamp, timezone || "UTC") },
  ];

  return {
    header: {
      title: copy.title,
      level: "warning",
    },
    sections: [
      {
        content: [
          {
            type: "quote",
            value: copy.quote(data),
          },
        ],
      },
      {
        title: copy.details,
        content: [{ type: "fields", items: fields }],
      },
    ],
    timestamp: new Date(),
  };
}
