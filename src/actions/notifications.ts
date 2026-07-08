"use server";

import { getTranslations } from "next-intl/server";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import {
  loadVipGroupUsageAlertConfig,
  saveVipGroupUsageAlertConfig,
} from "@/lib/redis/vip-group-usage-config";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { WebhookNotifier } from "@/lib/webhook";
import { buildTestMessage } from "@/lib/webhook/templates/test-messages";
import {
  getNotificationSettings,
  type NotificationSettings,
  type UpdateNotificationSettingsInput,
  updateNotificationSettings,
} from "@/repository/notifications";
import type { ActionResult } from "./types";

export interface NotificationSettingsView extends NotificationSettings {
  vipGroupUsageEnabled: boolean;
  vipGroupUsageCooldownSeconds: number;
}

export interface UpdateNotificationSettingsActionInput extends UpdateNotificationSettingsInput {
  vipGroupUsageEnabled?: boolean;
  vipGroupUsageCooldownSeconds?: number;
}

function hasOwnDefined<T extends object>(payload: T, key: keyof T): boolean {
  return Object.hasOwn(payload, key) && payload[key] !== undefined;
}

function hasDbSettingsPatch(payload: UpdateNotificationSettingsInput): boolean {
  return Object.keys(payload).some(
    (key) => payload[key as keyof UpdateNotificationSettingsInput] !== undefined
  );
}

async function buildNotificationSettingsView(
  settings: NotificationSettings
): Promise<NotificationSettingsView> {
  const vipConfig = await loadVipGroupUsageAlertConfig();
  return {
    ...settings,
    vipGroupUsageEnabled: vipConfig.enabled,
    vipGroupUsageCooldownSeconds: vipConfig.cooldownSeconds,
  };
}

/**
 * 获取通知设置
 */
export async function getNotificationSettingsAction(): Promise<NotificationSettingsView> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    throw new Error("无权限执行此操作");
  }
  return buildNotificationSettingsView(await getNotificationSettings());
}

/**
 * 更新通知设置并重新调度任务
 */
export async function updateNotificationSettingsAction(
  payload: UpdateNotificationSettingsActionInput
): Promise<ActionResult<NotificationSettingsView>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const tErrors = await getTranslations("errors");
    const before = await getNotificationSettings();
    const { vipGroupUsageEnabled, vipGroupUsageCooldownSeconds, ...dbPayload } = payload;
    const hasVipPatch =
      hasOwnDefined(payload, "vipGroupUsageEnabled") ||
      hasOwnDefined(payload, "vipGroupUsageCooldownSeconds");
    const shouldUpdateDb = hasDbSettingsPatch(dbPayload);

    let updated = before;

    if (shouldUpdateDb) {
      updated = await updateNotificationSettings(dbPayload);

      // 重新调度通知任务，使总开关、子开关、时间/间隔等变更立即生效（添加/移除 repeatable 作业）。
      // 动态导入避免静态加载 Bull；scheduleNotifications 内部已 fail-open，缺少 REDIS_URL 时不会影响设置保存。
      const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
      await scheduleNotifications();
    }

    if (hasVipPatch) {
      const saveResult = await saveVipGroupUsageAlertConfig({
        ...(vipGroupUsageEnabled !== undefined ? { enabled: vipGroupUsageEnabled } : {}),
        ...(vipGroupUsageCooldownSeconds !== undefined
          ? { cooldownSeconds: vipGroupUsageCooldownSeconds }
          : {}),
      });

      if (!saveResult.ok) {
        const errorCode = shouldUpdateDb
          ? ERROR_CODES.NOTIFICATION_SETTINGS_PARTIAL_FAILURE
          : saveResult.errorCode;
        const fallbackCode = shouldUpdateDb
          ? ERROR_CODES.NOTIFICATION_SETTINGS_PARTIAL_FAILURE
          : saveResult.errorCode;
        const error = tErrors(fallbackCode);

        emitActionAudit({
          category: "notification",
          action: "notification.update",
          targetType: "notification",
          before,
          after: updated,
          success: false,
          errorMessage: errorCode,
        });

        return {
          ok: false,
          error,
          errorCode,
          errorParams: shouldUpdateDb ? { reason: saveResult.errorCode } : undefined,
        };
      }
    }

    const view = await buildNotificationSettingsView(updated);

    emitActionAudit({
      category: "notification",
      action: "notification.update",
      targetType: "notification",
      before,
      after: view,
      success: true,
    });
    return { ok: true, data: view };
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新通知设置失败";
    emitActionAudit({
      category: "notification",
      action: "notification.update",
      targetType: "notification",
      success: false,
      errorMessage: "UPDATE_FAILED",
    });
    return {
      ok: false,
      error: message,
    };
  }
}

/**
 * 测试 Webhook 连通性
 */
export async function testWebhookAction(
  webhookUrl: string,
  type: NotificationJobType
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { success: false, error: "无权限执行此操作" };
  }

  if (!webhookUrl?.trim()) {
    return { success: false, error: "Webhook URL 不能为空" };
  }

  const trimmedUrl = webhookUrl.trim();

  try {
    const notifier = new WebhookNotifier(trimmedUrl, { maxRetries: 1 });
    const timezone = await resolveSystemTimezone();
    const testMessage = buildTestMessage(type, timezone);
    return notifier.send(testMessage, { timezone });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "测试连接失败",
    };
  }
}
