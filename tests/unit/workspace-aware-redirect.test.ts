import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaders = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

import {
  WORKSPACE_BASE_PATH_HEADER,
  redirectWithWorkspaceBase,
} from "@/lib/utils/workspace-aware-redirect";

describe("redirectWithWorkspaceBase", () => {
  beforeEach(() => {
    mockHeaders.mockReset();
    mockRedirect.mockReset();
  });

  it("prefixes redirect target with richer workspace base path", async () => {
    mockHeaders.mockResolvedValue(
      new Headers({
        [WORKSPACE_BASE_PATH_HEADER]: "/ws-a/project-b/user-c/vscode/d/proxy/3000",
      })
    );

    await redirectWithWorkspaceBase("/login?from=/dashboard", "zh-CN");

    expect(mockRedirect).toHaveBeenCalledWith(
      "/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN/login?from=/dashboard"
    );
  });

  it("normalizes missing leading slash in href", async () => {
    mockHeaders.mockResolvedValue(
      new Headers({
        [WORKSPACE_BASE_PATH_HEADER]: "/ws-a/project-b/user-c/vscode/d/proxy/3000",
      })
    );

    await redirectWithWorkspaceBase("login", "zh-CN");

    expect(mockRedirect).toHaveBeenCalledWith(
      "/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN/login"
    );
  });

  it("falls back to locale-root redirect when header is missing", async () => {
    mockHeaders.mockResolvedValue(new Headers());

    await redirectWithWorkspaceBase("/login", "zh-CN");

    expect(mockRedirect).toHaveBeenCalledWith("/zh-CN/login");
  });

  it("ignores invalid base path values without leading slash", async () => {
    mockHeaders.mockResolvedValue(
      new Headers({
        [WORKSPACE_BASE_PATH_HEADER]: "ws-a/project-b/user-c/vscode/d/proxy/3000",
      })
    );

    await redirectWithWorkspaceBase("/login", "zh-CN");

    expect(mockRedirect).toHaveBeenCalledWith("/zh-CN/login");
  });

  it("trims trailing slash from workspace base path", async () => {
    mockHeaders.mockResolvedValue(
      new Headers({
        [WORKSPACE_BASE_PATH_HEADER]: "/ws-a/project-b/user-c/vscode/d/proxy/3000/",
      })
    );

    await redirectWithWorkspaceBase("/login", "zh-CN");

    expect(mockRedirect).toHaveBeenCalledWith(
      "/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN/login"
    );
  });
});
