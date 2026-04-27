import { afterEach, describe, expect, it, vi } from "vitest";

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
  getEnvConfig: () => ({
    ENABLE_SECURE_COOKIES: false,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createNextUrl(pathname: string) {
  const url = new URL(`http://localhost:13500${pathname}`);
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
    clone() {
      return createNextUrl(`${url.pathname}${url.search}`);
    },
    toString() {
      return url.toString();
    },
  };
}

function makeRequest(
  pathname: string,
  options?: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  }
) {
  const headers = new Headers(options?.headers);

  return {
    method: "GET",
    nextUrl: createNextUrl(pathname),
    cookies: {
      get: (name: string) =>
        name in (options?.cookies ?? {})
          ? { name, value: options?.cookies?.[name] ?? "" }
          : undefined,
    },
    headers,
  } as unknown as import("next/server").NextRequest;
}

describe("proxy login redirect base-path recovery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses richer workspace base path for unauthenticated login redirect when referer outranks env base", async () => {
    vi.stubEnv("VSCODE_PROXY_URI", "https://nat-notebook-inspire.sii.edu.cn/proxy/{{port}}");
    vi.stubEnv("PORT", "3000");

    const localeResponse = new Response(null, { status: 200 });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");

    const workspaceBase = "/ws-a/project-b/user-c/vscode/d/session-e/proxy/3000";
    const response = proxyHandler(
      makeRequest("/dashboard", {
        headers: {
          referer: `https://nat-notebook-inspire.sii.edu.cn${workspaceBase}/zh-CN/dashboard`,
        },
      })
    );

    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain(`${workspaceBase}/zh-CN/login?from=%2Fdashboard`);
    expect(body).not.toContain('var targetPath = "/proxy/3000/zh-CN/login?from=%2Fdashboard";');
  });

  it("uses client-side relative redirect when gateway strips workspace base from the request path", async () => {
    vi.stubEnv("VSCODE_PROXY_URI", "https://nat-notebook-inspire.sii.edu.cn/proxy/{{port}}");
    vi.stubEnv("PORT", "3000");

    const localeResponse = new Response(null, { status: 200 });
    mockIntlMiddleware.mockReturnValue(localeResponse);

    const { default: proxyHandler } = await import("@/proxy");

    const response = proxyHandler(makeRequest("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();

    const body = await response.text();
    expect(body).toContain('var targetPath = "/zh-CN/login?from=%2Fdashboard";');
    expect(body).toContain("var currentPath = normalizeRedirectPath(window.location.pathname);");
    expect(body).toContain("window.location.replace(fullPath);");
  });
});
