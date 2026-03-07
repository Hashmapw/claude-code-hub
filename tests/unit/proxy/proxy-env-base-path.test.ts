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

function makeRequest(pathname: string, init?: { headers?: HeadersInit }) {
  const url = new URL(`http://localhost:4000${pathname}`);
  const nextUrl = createMockNextUrl(url);
  return {
    method: "GET",
    nextUrl,
    cookies: {
      get: () => undefined,
    },
    headers: new Headers(init?.headers),
  } as unknown as import("next/server").NextRequest;
}

describe("proxy env base path canonicalization", () => {
  const originalVscodeProxyUri = process.env.vscode_proxy_uri;
  const originalVscodeProxyUriUpper = process.env.VSCODE_PROXY_URI;
  const originalPort = process.env.PORT;

  const expectedEnvBasePath = "/ws-a/project-b/user-c/vscode/d/proxy/4000";

  beforeEach(() => {
    vi.resetModules();
    mockIntlMiddleware.mockReset();
    mockIntlMiddleware.mockReturnValue(new Response(null, { status: 200 }));

    const proxyUri =
      "https://nat-notebook-inspire.sii.edu.cn/ws-a/project-b/user-c/vscode/d/proxy/{{port}}";
    process.env.vscode_proxy_uri = proxyUri;
    process.env.VSCODE_PROXY_URI = proxyUri;
    process.env.PORT = "4000";
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

    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it("removes erroneous leading /proxy/4000 before ws base path without external redirect", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest("/proxy/4000/ws-a/project-b/user-c/vscode/d/proxy/4000/zh-CN/dashboard")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("recovers missing ws middle path for /proxy/4000/zh-CN routes", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/proxy/4000/zh-CN/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("recovers root _next path using env base path", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/_next/static/chunks/app.js"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toContain("/_next/static/chunks/app.js");
  });

  it("normalizes env base path that starts with accidental /proxy/PORT before ws segment", async () => {
    process.env.vscode_proxy_uri =
      "https://nat-notebook-inspire.sii.edu.cn/proxy/{{port}}/ws-a/project-b/user-c/vscode/d/proxy/{{port}}";
    process.env.VSCODE_PROXY_URI = process.env.vscode_proxy_uri;

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/proxy/4000/zh-CN/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("normalizes env base path with repeated leading /proxy/PORT prefixes", async () => {
    process.env.vscode_proxy_uri =
      "https://nat-notebook-inspire.sii.edu.cn/proxy/{{port}}/proxy/{{port}}/ws-a/project-b/user-c/vscode/d/proxy/{{port}}";
    process.env.VSCODE_PROXY_URI = process.env.vscode_proxy_uri;

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/zh-CN"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("does not let short /proxy/PORT env base downgrade canonical ws path", async () => {
    process.env.vscode_proxy_uri = "https://nat-notebook-inspire.sii.edu.cn/proxy/{{port}}";
    process.env.VSCODE_PROXY_URI = process.env.vscode_proxy_uri;

    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/4000/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps workspace-prefixed proxy route order stable without prepending /proxy", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/ws-a/project-b/user-c/vscode/d/proxy/4000/zh-CN"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("canonicalizes /proxy/4000 locale route to env ws base without duplicate proxy prefix", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(makeRequest("/proxy/4000/zh-CN"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("normalizes polluted /proxy/PORT/ws-* request in-process without external redirect", async () => {
    const { default: proxyHandler } = await import("@/proxy");
    const response = proxyHandler(
      makeRequest(
        "/proxy/4000/ws-6040202d-b785-4b37-98b0-c68d65dd52ce/project-4c3711a6-74af-4560-b60e-8bae6b39e186/user-6b74da98-40fa-4c4b-8795-ac2449fabd1b/vscode/b26ba028-6945-4ca1-8a38-051600c4fe20/5a897237-15be-4e4d-b75b-771edd984c8e/proxy/4000/zh-CN"
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
