import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import {
  preserveLegacyNotificationSettingsUpdateInput,
  sanitizeLegacyNotificationSettingsResponse,
} from "@/lib/api/legacy-action-sanitizers";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import {
  createProblemResponse,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { redactHeaderRecord, redactUrlCredentials } from "@/lib/api/v1/_shared/redaction";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import { jsonResponse, noContentResponse } from "@/lib/api/v1/_shared/response-helpers";
import {
  NotificationBindingUpdateSchema,
  NotificationSettingsUpdateSchema,
  NotificationTestWebhookRequestSchema,
} from "@/lib/api/v1/schemas/notifications";
import type { NotificationJobType } from "@/lib/constants/notification.constants";
import type { WebhookTarget } from "@/repository/webhook-targets";

function toNotificationJobType(type: string): NotificationJobType {
  switch (type) {
    case "circuit_breaker":
      return "circuit-breaker";
    case "daily_leaderboard":
      return "daily-leaderboard";
    case "cost_alert":
      return "cost-alert";
    case "cache_hit_rate_alert":
      return "cache-hit-rate-alert";
    case "vip_group_usage":
      return "vip-group-usage";
    default:
      throw new Error(`Unsupported notification type: ${type}`);
  }
}

export async function getNotificationSettings(c: Context): Promise<Response> {
  const actions = await import("@/actions/notifications");
  const result = await callAction(c, actions.getNotificationSettingsAction, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(sanitizeLegacyNotificationSettingsResponse(result.data));
}

export async function updateNotificationSettings(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, NotificationSettingsUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/notifications");
  const updatePayload = preserveLegacyNotificationSettingsUpdateInput(body.data);
  const result = await callAction(
    c,
    actions.updateNotificationSettingsAction,
    [updatePayload] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(sanitizeLegacyNotificationSettingsResponse(result.data));
}

export async function testNotificationWebhook(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, NotificationTestWebhookRequestSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/notifications");
  const result = await callAction(
    c,
    actions.testWebhookAction,
    [body.data.webhookUrl, toNotificationJobType(body.data.type)] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data);
}

export async function getNotificationBindings(c: Context): Promise<Response> {
  const type = c.req.param("type");
  const actions = await import("@/actions/notification-bindings");
  const result = await callAction(
    c,
    actions.getBindingsForTypeAction,
    [type] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data.map(sanitizeBinding) });
}

export async function updateNotificationBindings(c: Context): Promise<Response> {
  const type = c.req.param("type");
  const body = await parseHonoJsonBody(c, NotificationBindingUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/notification-bindings");
  const result = await callAction(
    c,
    actions.updateBindingsAction,
    [type, body.data.items] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

function sanitizeBinding<T extends { target: WebhookTarget }>(binding: T) {
  return {
    ...binding,
    target: {
      ...binding.target,
      webhookUrl: binding.target.webhookUrl ? "[REDACTED]" : null,
      customHeaders: redactHeaderRecord(binding.target.customHeaders),
      proxyUrl: redactUrlCredentials(binding.target.proxyUrl),
      telegramBotToken: null,
      dingtalkSecret: null,
    },
  };
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const status = detail.includes("权限") || detail.includes("无权限") ? 403 : 400;
  const isExplicitRuntimeConfigFailure =
    result.errorCode === "VIP_GROUP_USAGE_CONFIG_REDIS_UNAVAILABLE" ||
    result.errorCode === "VIP_GROUP_USAGE_CONFIG_SAVE_FAILED" ||
    result.errorCode === "NOTIFICATION_SETTINGS_PARTIAL_FAILURE";
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: result.errorCode ?? "notification.action_failed",
    errorParams: result.errorParams,
    detail: isExplicitRuntimeConfigFailure ? detail : publicActionErrorDetail(status),
  });
}
