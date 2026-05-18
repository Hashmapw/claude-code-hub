"use server";

import { getTranslations } from "next-intl/server";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import { logger } from "@/lib/logger";
import {
  loadVipGroupUsageAlertConfig,
  saveVipGroupUsageAlertConfig,
} from "@/lib/redis/vip-group-usage-config";
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

function hasDbNotificationSettingsPatch(payload: UpdateNotificationSettingsInput): boolean {
  return Object.keys(payload).length > 0;
}

type TranslationFunction = Awaited<ReturnType<typeof getTranslations<"errors">>>;

function vipConfigSaveFailureResult(
  errorCode: string,
  hasDbPatch: boolean,
  tError: TranslationFunction
): ActionResult<NotificationSettingsView> {
  const messageCode = hasDbPatch ? "NOTIFICATION_SETTINGS_PARTIAL_FAILURE" : errorCode;
  return {
    ok: false,
    error: tError(messageCode),
    errorCode,
  };
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
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("PERMISSION_DENIED"), errorCode: "PERMISSION_DENIED" };
    }

    const before = await buildNotificationSettingsView(await getNotificationSettings());
    const { vipGroupUsageEnabled, vipGroupUsageCooldownSeconds, ...dbPayload } = payload;

    const updatedDbSettings = hasDbNotificationSettingsPatch(dbPayload)
      ? await updateNotificationSettings(dbPayload)
      : await getNotificationSettings();

    const hasVipPatch =
      vipGroupUsageEnabled !== undefined || vipGroupUsageCooldownSeconds !== undefined;
    if (hasVipPatch) {
      const vipSaveResult = await saveVipGroupUsageAlertConfig({
        enabled: vipGroupUsageEnabled,
        cooldownSeconds: vipGroupUsageCooldownSeconds,
      });
      if (!vipSaveResult.ok) {
        return vipConfigSaveFailureResult(
          vipSaveResult.errorCode,
          hasDbNotificationSettingsPatch(dbPayload),
          tError
        );
      }
    }

    const updated = await buildNotificationSettingsView(updatedDbSettings);

    // 重新调度通知任务（仅生产环境）。VIP 配置是请求级 Redis runtime 配置，不需要调度；
    // 但当同一次更新包含 DB 调度字段时仍保持原有行为。
    if (hasDbNotificationSettingsPatch(dbPayload)) {
      if (process.env.NODE_ENV === "production") {
        // 动态导入避免 Turbopack 编译 Bull 模块
        const { scheduleNotifications } = await import("@/lib/notification/notification-queue");
        await scheduleNotifications();
      } else {
        logger.warn({
          action: "schedule_notifications_skipped",
          reason: "development_mode",
          message: "Notification scheduling is disabled in development mode",
        });
      }
    }

    emitActionAudit({
      category: "notification",
      action: "notification.update",
      targetType: "notification",
      before,
      after: updated,
      success: true,
    });
    return { ok: true, data: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : tError("UPDATE_FAILED");
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
