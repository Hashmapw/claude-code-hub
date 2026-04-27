import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Hoist mocks before imports -- mock transitive dependencies to avoid
// next-intl pulling in next/navigation (not resolvable in vitest)
const mockIntlMiddleware = vi.hoisted(() => vi.fn());
vi.mock("next-intl/middleware", () => ({
  default: () => mockIntlMiddleware,
}));

vi.mock("@/i18n/routing", () => ({
  routing: {
    locales: ["zh-CN", "en"],
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeRequest(pathname: string, cookies: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost:13500${pathname}`);
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

async function expectClientSideLoginRedirect(response: Response, expectedTarget: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();

  const body = await response.text();
  expect(body).toContain(expectedTarget);
  expect(body).toContain("window.location.replace(fullPath)");
}

describe("proxy auth cookie passthrough", () => {
  beforeEach(() => {
    vi.resetModules();
    mockIntlMiddleware.mockReset();
    process.env.VSCODE_PROXY_URI = "";
    process.env.vscode_proxy_uri = "";
  });

  it("redirects to login when no auth cookie is present", async () => {
    const localeResponse = new Response(null, { status: 200 });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/dashboard"));

    await expectClientSideLoginRedirect(response, "/zh-CN/login?from=%2Fdashboard");
  }, 60_000);

  it("passes through when auth cookie exists without deleting it", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "locale-response" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/zh-CN/dashboard", { cch_auth: "sid_test-session-id" })
    );

    // Should return the locale response, not a redirect
    expect(response.headers.get("x-test")).toBe("locale-response");
    // Should NOT have a Set-Cookie header that deletes the auth cookie
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeNull();
  });

  it("allows public paths without any cookie", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "public-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/login"));

    expect(response.headers.get("x-test")).toBe("public-ok");
  });

  it("treats nested public paths as public but rejects prefix collisions", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "public-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler, matchesPublicPath } = await import("@/proxy");

    const nestedPublicResponse = proxyHandler(makeRequest("/zh-CN/login/help"));
    expect(nestedPublicResponse.headers.get("x-test")).toBe("public-ok");
    expect(matchesPublicPath("/login/help", "/login")).toBe(true);
    expect(matchesPublicPath("/loginx", "/login")).toBe(false);

    const collisionResponse = proxyHandler(makeRequest("/zh-CN/loginx"));
    await expectClientSideLoginRedirect(collisionResponse, "/zh-CN/login?from=%2Floginx");
  });
});
