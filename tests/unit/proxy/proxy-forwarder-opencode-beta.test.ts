import { describe, expect, it } from "vitest";
import { appendOpencodeClaudeMessagesBetaIfNeeded } from "@/app/v1/_lib/proxy/opencode-beta";

function makeSession(pathname: string, userAgent: string) {
  return {
    headers: new Headers({ "user-agent": userAgent }),
    requestUrl: new URL(`http://localhost${pathname}`),
  };
}

function makeProvider(providerType: string) {
  return { providerType };
}

describe("opencode Claude Messages beta query parameter", () => {
  it("adds beta=true only for opencode Claude /v1/messages requests", () => {
    const result = appendOpencodeClaudeMessagesBetaIfNeeded(
      "https://api.anthropic.com/v1/messages?x=1",
      makeSession("/v1/messages", "opencode/1.0") as never,
      makeProvider("claude") as never
    );

    const url = new URL(result);
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("beta")).toBe("true");
  });

  it("does not overwrite an explicit beta value", () => {
    const result = appendOpencodeClaudeMessagesBetaIfNeeded(
      "https://api.anthropic.com/v1/messages?beta=false",
      makeSession("/v1/messages", "opencode") as never,
      makeProvider("claude-auth") as never
    );

    expect(new URL(result).searchParams.get("beta")).toBe("false");
  });

  it.each([
    ["non-opencode", "/v1/messages", "curl/8", "claude"],
    ["non-claude provider", "/v1/messages", "opencode", "openai"],
    ["non-messages path", "/v1/chat/completions", "opencode", "claude"],
  ])("does not add beta for %s", (_label, pathname, userAgent, providerType) => {
    const original = "https://api.example.com/v1/messages";

    const result = appendOpencodeClaudeMessagesBetaIfNeeded(
      original,
      makeSession(pathname, userAgent) as never,
      makeProvider(providerType) as never
    );

    expect(result).toBe(original);
  });
});
