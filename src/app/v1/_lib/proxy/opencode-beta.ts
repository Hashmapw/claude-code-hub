import type { ProviderType } from "@/types/provider";

type OpenCodeBetaUrlOptions = {
  upstreamUrl: string;
  userAgent: string | null;
  providerType: ProviderType;
  requestPath: string;
};

export function appendOpenCodeBetaQuery({
  upstreamUrl,
  userAgent,
  providerType,
  requestPath,
}: OpenCodeBetaUrlOptions): string {
  if (
    !userAgent?.toLowerCase().includes("opencode") ||
    (providerType !== "claude" && providerType !== "claude-auth") ||
    requestPath !== "/v1/messages"
  ) {
    return upstreamUrl;
  }

  try {
    const url = new URL(upstreamUrl);
    if (url.searchParams.has("beta")) {
      return upstreamUrl;
    }

    url.searchParams.append("beta", "true");
    return url.toString();
  } catch {
    return upstreamUrl;
  }
}
