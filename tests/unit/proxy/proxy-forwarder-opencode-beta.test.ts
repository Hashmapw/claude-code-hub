import { describe, expect, it } from "vitest";
import { appendOpenCodeBetaQuery } from "@/app/v1/_lib/proxy/opencode-beta";
import type { ProviderType } from "@/types/provider";

function rewriteUrl({
  upstreamUrl = "https://api.anthropic.com/v1/messages",
  userAgent = "opencode/1.0.0",
  providerType = "claude",
  requestPath = "/v1/messages",
}: {
  upstreamUrl?: string;
  userAgent?: string | null;
  providerType?: ProviderType;
  requestPath?: string;
} = {}): string {
  return appendOpenCodeBetaQuery({ upstreamUrl, userAgent, providerType, requestPath });
}

describe("OpenCode Claude beta forwarding", () => {
  it("adds beta=true for OpenCode Claude messages while preserving existing query parameters", () => {
    expect(
      rewriteUrl({
        upstreamUrl: "https://api.anthropic.com/v1/messages?region=us",
        userAgent: "OpenCode/1.0.0",
      })
    ).toBe("https://api.anthropic.com/v1/messages?region=us&beta=true");
  });

  it("supports claude-auth providers", () => {
    expect(rewriteUrl({ providerType: "claude-auth" })).toBe(
      "https://api.anthropic.com/v1/messages?beta=true"
    );
  });

  it("does not overwrite an existing beta query value", () => {
    const upstreamUrl = "https://api.anthropic.com/v1/messages?beta=false&region=us";
    expect(rewriteUrl({ upstreamUrl })).toBe(upstreamUrl);
  });

  it("leaves requests from other clients unchanged", () => {
    const upstreamUrl = "https://api.anthropic.com/v1/messages?region=us";
    expect(rewriteUrl({ upstreamUrl, userAgent: "claude-cli/1.0.0" })).toBe(upstreamUrl);
  });

  it("leaves non-Claude providers unchanged", () => {
    const upstreamUrl = "https://api.example.com/v1/messages?region=us";
    expect(rewriteUrl({ upstreamUrl, providerType: "openai-compatible" })).toBe(upstreamUrl);
  });

  it("leaves non-messages paths unchanged", () => {
    const upstreamUrl = "https://api.anthropic.com/v1/messages/count_tokens?region=us";
    expect(rewriteUrl({ upstreamUrl, requestPath: "/v1/messages/count_tokens" })).toBe(upstreamUrl);
  });

  it("fails open when the upstream URL is invalid", () => {
    const upstreamUrl = "not a valid URL";
    expect(rewriteUrl({ upstreamUrl })).toBe(upstreamUrl);
  });
});
