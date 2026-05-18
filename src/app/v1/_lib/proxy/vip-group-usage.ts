import { logger } from "@/lib/logger";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import type { Provider } from "@/types/provider";
import type { ProxySession } from "./session";

function isVipProviderGroup(groupTag: string | null | undefined): boolean {
  return parseProviderGroups(groupTag).some((tag) => tag.toLowerCase() === "vip");
}

/**
 * Best-effort VIP group usage alert. This must never affect the proxy response path.
 */
export async function maybeSendVipGroupUsageAlert(
  session: ProxySession,
  provider: Pick<Provider, "id" | "name" | "groupTag">,
  providerGroupTag: string | null | undefined = provider.groupTag
): Promise<void> {
  if (!isVipProviderGroup(providerGroupTag)) {
    return;
  }

  const user = session.messageContext?.user ?? session.authState?.user;
  if (!user || typeof user.id !== "number" || !user.name) {
    logger.debug("[VipGroupUsage] Skip alert because user context is missing", {
      providerId: provider.id,
      sessionId: session.sessionId ?? null,
    });
    return;
  }

  try {
    const { sendVipGroupUsageAlert } = await import("@/lib/notification/notifier");
    await sendVipGroupUsageAlert({
      userId: user.id,
      userName: user.name,
      providerId: provider.id,
      providerName: provider.name,
      providerGroupTag: providerGroupTag || "vip",
      model: session.getOriginalModel() || session.request.model || "",
      sessionId: session.sessionId || "",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn("[VipGroupUsage] Failed to enqueue alert", {
      providerId: provider.id,
      providerName: provider.name,
      sessionId: session.sessionId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
