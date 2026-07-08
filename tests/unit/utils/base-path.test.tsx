import { afterEach, describe, expect, it, vi } from "vitest";

function setPath(pathname: string) {
  window.history.replaceState(null, "", `${window.location.origin}${pathname}`);
}

describe("base path utilities", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setPath("/");
  });

  it("extracts the SII Notebook deep proxy base path before locale routes", async () => {
    vi.stubEnv("SII_PROXY_SUPPORT", "true");
    setPath("/ws-abc/project-1/user-2/vscode/ide/session/proxy/3000/en/login");

    const { getBasePath, apiUrl, withBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("/ws-abc/project-1/user-2/vscode/ide/session/proxy/3000");
    expect(apiUrl("/auth/login")).toBe(
      "/ws-abc/project-1/user-2/vscode/ide/session/proxy/3000/api/auth/login"
    );
    expect(withBasePath("/en/dashboard")).toBe(
      "/ws-abc/project-1/user-2/vscode/ide/session/proxy/3000/en/dashboard"
    );
  });

  it("cleans polluted duplicated proxy prefixes", async () => {
    vi.stubEnv("SII_PROXY_SUPPORT", "true");
    setPath("/proxy/3000/ws-abc/project-1/user-2/vscode/ide/session/proxy/3000/zh-CN");

    const { getBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("/ws-abc/project-1/user-2/vscode/ide/session/proxy/3000");
  });

  it("returns root paths when SII proxy support is disabled", async () => {
    vi.stubEnv("SII_PROXY_SUPPORT", "false");
    setPath("/ws-abc/project-1/user-2/vscode/ide/session/proxy/3000/en/login");

    const { getBasePath, apiUrl, withBasePath } = await import("@/lib/utils/base-path");

    expect(getBasePath()).toBe("");
    expect(apiUrl("/version")).toBe("/api/version");
    expect(withBasePath("/en/login")).toBe("/en/login");
  });
});
