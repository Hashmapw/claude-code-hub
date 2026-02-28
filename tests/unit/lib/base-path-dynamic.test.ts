/* @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { getBasePath } from "@/lib/utils/base-path";

function setPath(pathname: string): void {
  window.history.replaceState({}, "", pathname);
}

describe("base-path dynamic recalculation", () => {
  it("recalculates basePath when pathname changes", () => {
    setPath("/proxy/4000/ws-a/project-b/user-c/vscode/d/proxy/4000/zh-CN/dashboard");
    expect(getBasePath()).toBe("/ws-a/project-b/user-c/vscode/d/proxy/4000");

    setPath("/ws-x/project-y/user-z/vscode/q/proxy/4000/zh-CN/dashboard");
    expect(getBasePath()).toBe("/ws-x/project-y/user-z/vscode/q/proxy/4000");
  });

  it("does not keep stale short /proxy/PORT prefix after switching to richer ws prefix", () => {
    setPath("/proxy/4000/zh-CN/login");
    expect(getBasePath()).toBe("/proxy/4000");

    setPath("/ws-a/project-b/user-c/vscode/d/proxy/4000/zh-CN/dashboard");
    expect(getBasePath()).toBe("/ws-a/project-b/user-c/vscode/d/proxy/4000");
  });

  it("detects canonical ws base path from locale-first polluted pathname", () => {
    setPath("/zh-CN/ws-a/project-b/user-c/vscode/d/proxy/4000/dashboard");
    expect(getBasePath()).toBe("/ws-a/project-b/user-c/vscode/d/proxy/4000");
  });

  it("detects canonical ws base path from proxy+locale-before-workspace polluted pathname", () => {
    setPath("/proxy/4000/zh-CN/ws-a/project-b/user-c/vscode/d/proxy/4000/dashboard");
    expect(getBasePath()).toBe("/ws-a/project-b/user-c/vscode/d/proxy/4000");
  });
});
