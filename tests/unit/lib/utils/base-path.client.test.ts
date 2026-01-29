// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

function setPath(path: string) {
  window.history.pushState({}, "", path);
}

describe("getBasePath (client)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    delete process.env.VSCODE_PROXY_URI;
    setPath("/");
  });

  it("extracts proxy base path before locale", async () => {
    setPath("/ws-abc/proxy/4000/zh-CN/dashboard");
    const { getBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("/ws-abc/proxy/4000");
  });

  it("handles proxy root without locale", async () => {
    setPath("/ws-abc/proxy/4000/");
    const { getBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("/ws-abc/proxy/4000");
  });

  it("returns empty string when no proxy prefix", async () => {
    setPath("/zh-CN/dashboard");
    const { getBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("");
  });

  it("detects base path before api route", async () => {
    setPath("/ws-abc/proxy/4000/api/auth/login");
    const { getBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("/ws-abc/proxy/4000");
  });
});
