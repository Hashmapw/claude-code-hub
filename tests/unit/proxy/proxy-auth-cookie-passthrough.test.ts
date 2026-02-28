import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  return {
    ...actual,
    isDevelopment: () => false,
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createMockNextUrl(url: URL): {
  pathname: string;
  search: string;
  toString: () => string;
  clone: () => ReturnType<typeof createMockNextUrl>;
} {
  return {
    get pathname() {
      return url.pathname;
    },
    set pathname(value: string) {
      url.pathname = value;
    },
    get search() {
      return url.search;
    },
    set search(value: string) {
      url.search = value;
    },
    toString: () => url.toString(),
    clone: () => createMockNextUrl(new URL(url.toString())),
  };
}

function makeRequest(
  pathname: string,
  cookies: Record<string, string> = {},
  init?: { headers?: HeadersInit }
) {
  const url = new URL(`http://localhost:4000${pathname}`);
  const nextUrl = createMockNextUrl(url);
  return {
    method: "GET",
    nextUrl,
    cookies: {
      get: (name: string) => (name in cookies ? { name, value: cookies[name] } : undefined),
    },
    headers: new Headers(init?.headers),
  } as unknown as import("next/server").NextRequest;
}

async function runRedirectHtml(html: string, pathname: string): Promise<string> {
  const scriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i);
  expect(scriptMatch?.[1]).toBeDefined();

  let redirectedTo = "";
  const windowMock = {
    location: {
      pathname,
      replace: (next: string) => {
        redirectedTo = next;
      },
    },
  };
  const documentMock = { cookie: "" };

  const execute = new Function("window", "document", scriptMatch?.[1] ?? "");
  execute(windowMock, documentMock);

  return redirectedTo;
}

describe("proxy auth cookie passthrough", () => {
  const originalVscodeProxyUri = process.env.vscode_proxy_uri;
  const originalVscodeProxyUriUpper = process.env.VSCODE_PROXY_URI;

  beforeEach(() => {
    vi.resetModules();
    mockIntlMiddleware.mockReset();
    delete process.env.vscode_proxy_uri;
    delete process.env.VSCODE_PROXY_URI;
  });

  afterEach(() => {
    if (originalVscodeProxyUri === undefined) {
      delete process.env.vscode_proxy_uri;
    } else {
      process.env.vscode_proxy_uri = originalVscodeProxyUri;
    }

    if (originalVscodeProxyUriUpper === undefined) {
      delete process.env.VSCODE_PROXY_URI;
    } else {
      process.env.VSCODE_PROXY_URI = originalVscodeProxyUriUpper;
    }
  });

  it("redirects to login when no auth cookie is present", async () => {
    const localeResponse = new Response(null, { status: 200 });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("location")).toBeNull();

    const html = await response.text();
    expect(html).toContain("/zh-CN/login?from=%2Fdashboard");
  });

  it("passes through when auth cookie exists without deleting it", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "locale-response" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/zh-CN/dashboard", { "auth-token": "sid_test-session-id" })
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

  it("treats prefixed locale login path as public path", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "prefixed-public-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/4000/zh-CN/login")
    );

    expect(response.headers.get("x-test")).toBe("prefixed-public-ok");
  });

  it("maps workspace-prefixed protected path to app route before locale/auth pipeline", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "workspace-rewritten-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/4000/zh-CN/dashboard", {
        "auth-token": "sid_test-session-id",
      })
    );

    expect(mockIntlMiddleware).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/zh-CN/dashboard");
    expect(response.headers.get("location")).toBeNull();
  });

  it("recovers proxy prefix from referer when root app path loses middle prefix", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "public-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/zh-CN/login",
        {},
        {
          headers: { referer: "http://localhost:4000/ws-a/proxy/4000/zh-CN/dashboard" },
        }
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/ws-a/proxy/4000/zh-CN/login");
  });

  it("recovers proxy prefix from referer for root _next static asset path", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "should-not-reach-intl" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/_next/static/chunks/app.js",
        {},
        {
          headers: { referer: "http://localhost:4000/ws-a/proxy/4000/zh-CN/dashboard" },
        }
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/ws-a/proxy/4000/_next/static/chunks/app.js"
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("recovers /proxy/PORT locale path from referer when ws middle segment is missing", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "public-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/proxy/4000/zh-CN/login",
        {},
        {
          headers: { referer: "http://localhost:4000/ws-a/proxy/4000/zh-CN/dashboard" },
        }
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/ws-a/proxy/4000/zh-CN/login");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not downgrade canonical ws-prefixed path to short /proxy/PORT referer base", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "canonical-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/ws-a/proxy/4000/zh-CN",
        {},
        { headers: { referer: "http://localhost:4000/proxy/4000/zh-CN/login" } }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rewrites prefixed _next static asset path to root _next path", async () => {
    mockIntlMiddleware.mockClear();

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/ws-a/proxy/4000/_next/static/chunks/app.js"));

    expect(mockIntlMiddleware).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/_next/static/chunks/app.js");
    expect(response.headers.get("location")).toBeNull();
  });

  it("rewrites duplicated leading proxy prefix _next asset path to root _next path", async () => {
    mockIntlMiddleware.mockClear();

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/proxy/4000/ws-a/proxy/4000/_next/static/chunks/545e1c19bfb74302.js")
    );

    expect(mockIntlMiddleware).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/_next/static/chunks/545e1c19bfb74302.js"
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps richer target prefix when current path is polluted with /proxy/PORT prefix", async () => {
    const localeResponse = new Response(null, {
      status: 307,
      headers: { location: "/ws-a/proxy/4000/zh-CN/dashboard" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN/login"));

    expect(response.status).toBe(200);
    const html = await response.text();
    const redirectedTo = await runRedirectHtml(html, "/proxy/4000/ws-a/proxy/4000/zh-CN/login");

    expect(redirectedTo).toBe("/ws-a/proxy/4000/zh-CN/dashboard");
  });

  it("keeps canonical ws order when relative redirect starts from polluted /proxy/PORT/ws path", async () => {
    const localeResponse = new Response(null, {
      status: 307,
      headers: { location: "/zh-CN" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/proxy/4000/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/zh-CN",
        { "auth-token": "sid_test-session-id" }
      )
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    const redirectedTo = await runRedirectHtml(
      html,
      "/proxy/4000/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/zh-CN"
    );

    expect(redirectedTo).toBe(
      "/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/zh-CN"
    );
    expect(redirectedTo).not.toContain("/proxy/4000/ws-");
    expect(redirectedTo).not.toContain("/proxy/4000/proxy/4000");
  });

  it("reorders locale-before-workspace redirect target into canonical workspace-first order", async () => {
    const localeResponse = new Response(null, {
      status: 307,
      headers: {
        location:
          "/zh-CN/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/dashboard",
      },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/dashboard",
        { "auth-token": "sid_test-session-id" }
      )
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    const redirectedTo = await runRedirectHtml(
      html,
      "/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/dashboard"
    );

    expect(redirectedTo).toBe(
      "/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/zh-CN/dashboard"
    );
    expect(redirectedTo).not.toContain("/zh-CN/ws-");
    expect(redirectedTo).not.toContain("/proxy/4000/ws-");
  });

  it("reorders proxy+locale-before-workspace redirect target into canonical workspace-first order", async () => {
    const localeResponse = new Response(null, {
      status: 307,
      headers: {
        location:
          "/proxy/4000/zh-CN/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/dashboard",
      },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/dashboard",
        { "auth-token": "sid_test-session-id" }
      )
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    const redirectedTo = await runRedirectHtml(
      html,
      "/proxy/4000/zh-CN/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/dashboard"
    );

    expect(redirectedTo).toBe(
      "/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/zh-CN/dashboard"
    );
    expect(redirectedTo).not.toContain("/proxy/4000/zh-CN/ws-");
  });

  it("bypasses self-redirect when normalized target equals current workspace path", async () => {
    const localeResponse = new Response(null, {
      status: 307,
      headers: { location: "/zh-CN/ws-a/proxy/4000/zh-CN/dashboard" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/ws-a/proxy/4000/zh-CN/dashboard", { "auth-token": "sid_test-session-id" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-cch-proxy-rev")).toBe("20260301-ws-hard-guard-v4");
    const html = await response.text();
    expect(html).not.toContain("window.location.replace");
  });

  it("normalizes duplicated leading /proxy/PORT prefix in-process without external redirect", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "normalized-in-process" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/proxy/4000/ws-a/proxy/4000/zh-CN/dashboard?tab=overview", {
        "auth-token": "sid_test-session-id",
      })
    );

    expect(mockIntlMiddleware).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/zh-CN/dashboard?tab=overview"
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("normalizes duplicated leading /proxy/PORT prefix when locale is at path end without redirect", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "normalized-in-process" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/proxy/4000/ws-a/proxy/4000/zh-CN", { "auth-token": "sid_test-session-id" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("normalized-in-process");
    expect(response.headers.get("location")).toBeNull();
  });

  it("uses locale-stripped path in from param for prefixed dashboard request", async () => {
    const localeResponse = new Response(null, { status: 200 });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/ws-a/proxy/4000/zh-CN/dashboard"));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("/zh-CN/login?from=%2Fdashboard");
    expect(html).not.toContain("from=%2Fws-a%2Fproxy%2F4000%2Fzh-CN%2Fdashboard");
  });
});
