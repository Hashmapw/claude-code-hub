import { beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
}

describe("getBasePath (server)", () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
  });

  it("uses NEXT_PUBLIC_BASE_PATH when set", async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = "/proxy/4000/";

    const { getBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("/proxy/4000");
  });

  it("falls back to VSCODE_PROXY_URI when base path is not set", async () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.PORT = "4000";
    process.env.VSCODE_PROXY_URI = "https://example.com/ws-123/vscode/abc/proxy/{{port}}/";

    const { getBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("/ws-123/vscode/abc/proxy/4000");
  });
});
