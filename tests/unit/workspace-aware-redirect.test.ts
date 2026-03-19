import { describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("workspace aware redirect", () => {
  it("prepends workspace base path from request headers", async () => {
    headersMock.mockResolvedValue(
      new Headers({
        "x-cch-base-path": "/ws-a/project-b/user-c/vscode/d/proxy/3000",
      })
    );

    const { redirectWithWorkspaceBase } = await import("@/lib/utils/workspace-aware-redirect");
    await redirectWithWorkspaceBase("/login?from=/dashboard", "zh-CN");

    expect(redirectMock).toHaveBeenCalledWith(
      "/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN/login?from=/dashboard"
    );
  });

  it("falls back to locale-prefixed path when workspace header is absent", async () => {
    headersMock.mockResolvedValue(new Headers());

    const { redirectWithWorkspaceBase } = await import("@/lib/utils/workspace-aware-redirect");
    await redirectWithWorkspaceBase("/login", "zh-CN");

    expect(redirectMock).toHaveBeenCalledWith("/zh-CN/login");
  });
});
