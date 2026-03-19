import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const url = new URL(`http://localhost:3000${pathname}`);
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

    expect(response.headers.get("x-test")).toBe("locale-response");
    expect(response.headers.get("set-cookie")).toBeNull();
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
      makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN/login")
    );

    expect(mockIntlMiddleware).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/zh-CN/login");
    expect(response.headers.get("location")).toBeNull();
  });

  it("maps workspace-prefixed bare locale root to app locale route when auth cookie exists", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN", {
        "auth-token": "sid_test-session-id",
      })
    );

    expect(mockIntlMiddleware).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/zh-CN");
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects workspace-prefixed bare locale root to login when auth cookie is absent", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("location")).toBeNull();

    const html = await response.text();
    expect(html).toContain("/zh-CN/login");
  });

  it("maps workspace-prefixed protected path to app route before locale/auth pipeline", async () => {
    const localeResponse = new Response(null, {
      status: 200,
      headers: { "x-test": "workspace-rewritten-ok" },
    });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/3000/zh-CN/dashboard", {
        "auth-token": "sid_test-session-id",
      })
    );

    expect(mockIntlMiddleware).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/zh-CN/dashboard");
    expect(response.headers.get("x-middleware-request-x-cch-base-path")).toBe(
      "/ws-a/project-b/user-c/vscode/d/proxy/3000"
    );
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
          headers: { referer: "http://localhost:3000/ws-a/proxy/3000/zh-CN/dashboard" },
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain("/zh-CN/login");
  });

  it("recovers proxy prefix from referer for root _next static asset path", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/_next/static/chunks/app.js",
        {},
        {
          headers: { referer: "http://localhost:3000/ws-a/proxy/3000/zh-CN/dashboard" },
        }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain("/_next/static/chunks/app.js");
  });
});
