import type { Provider } from "@/types/provider";
import type { ProxySession } from "./session";

function isOpencodeUserAgent(session: ProxySession): boolean {
  const userAgent = session.headers.get("user-agent")?.trim().toLowerCase() ?? "";
  return userAgent.includes("opencode");
}

export function appendOpencodeClaudeMessagesBetaIfNeeded(
  proxyUrl: string,
  session: ProxySession,
  provider: Pick<Provider, "providerType">
): string {
  if (!isOpencodeUserAgent(session)) return proxyUrl;
  if (provider.providerType !== "claude" && provider.providerType !== "claude-auth") {
    return proxyUrl;
  }
  if (session.requestUrl.pathname !== "/v1/messages") return proxyUrl;

  try {
    const url = new URL(proxyUrl);
    if (url.searchParams.has("beta")) return proxyUrl;
    url.searchParams.set("beta", "true");
    return url.toString();
  } catch {
    return proxyUrl;
  }
}
