import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeCookieName } from "@/i18n/config";

const mockIntlMiddleware = vi.hoisted(() =>
  vi.fn((request: NextRequest) => {
    const response = new Response(null, { status: 200 });
    response.headers.set("x-seen-public-status", request.headers.get("x-cch-public-status") ?? "");
    return response;
  })
);

vi.mock("next-intl/middleware", () => ({
  default: () => mockIntlMiddleware,
}));

vi.mock("@/i18n/routing", () => ({
  routing: {
    locales: ["en", "zh-CN"],
    defaultLocale: "zh-CN",
  },
}));

vi.mock("@/lib/config/env.schema", () => ({
  isDevelopment: () => false,
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "cch_auth",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: () => {},
  },
}));

async function expectClientSideRedirect(
  response: Response,
  expectedTarget: string,
  unexpectedTarget?: string
) {
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();

  const body = await response.text();
  expect(body).toContain(expectedTarget);
  expect(body).toContain("window.location.replace(fullPath)");
  if (unexpectedTarget) {
    expect(body).not.toContain(unexpectedTarget);
  }
}

describe("public status proxy path", () => {
  beforeEach(() => {
    vi.resetModules();
    mockIntlMiddleware.mockClear();
    process.env.VSCODE_PROXY_URI = "";
    process.env.vscode_proxy_uri = "";
  });

  it("allows locale-prefixed public status without redirect", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en/status"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects protected routes without auth", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en/dashboard"));
    await expectClientSideRedirect(response, "/en/login?from=%2Fdashboard");
  });

  it("redirects bare root to locale login with a dashboard fallback", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/"));
    await expectClientSideRedirect(response, "/zh-CN/login?from=%2Fdashboard");
  });

  it("prefers NEXT_LOCALE when redirecting an unprefixed protected route", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const request = new NextRequest("http://localhost/dashboard");
    request.cookies.set(localeCookieName, "en");
    const response = proxyHandler(request);
    await expectClientSideRedirect(response, "/en/login?from=%2Fdashboard");
  });

  it("falls back safely when NEXT_LOCALE cookie is malformed", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const request = new NextRequest("http://localhost/dashboard");
    request.headers.set("cookie", `${localeCookieName}=%E0%A4%A`);

    expect(() => proxyHandler(request)).not.toThrow();

    const response = proxyHandler(request);
    await expectClientSideRedirect(response, "/zh-CN/login?from=%2Fdashboard");
  });

  it("normalizes repeated locale prefixes in the login from parameter", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en/en/dashboard"));
    await expectClientSideRedirect(
      response,
      "/en/login?from=%2Fdashboard",
      "from=%2Fen%2Fdashboard"
    );
  });

  it("redirects locale root to login with a dashboard fallback", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(new NextRequest("http://localhost/en"));
    await expectClientSideRedirect(response, "/en/login?from=%2Fdashboard");
  });

  it("strips spoofed x-cch-public-status on non-status requests", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      new NextRequest("http://localhost/en/dashboard", {
        headers: {
          "x-cch-public-status": "1",
          cookie: "cch_auth=test",
        },
      })
    );

    expect(response.headers.get("x-seen-public-status")).toBeNull();
  });
});
