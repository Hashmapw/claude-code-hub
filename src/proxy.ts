import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { type Locale, localeCookieName } from "@/i18n/config";
import { getLocaleFromValue, normalizePathnameForLocaleNavigation } from "@/i18n/pathname";
import { routing } from "@/i18n/routing";
import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { isDevelopment } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { isSiiProxySupportEnabled } from "@/lib/utils/sii-proxy-support";
import { WORKSPACE_BASE_PATH_HEADER } from "@/lib/utils/workspace-aware-redirect";

// Public paths that don't require authentication
// Note: These paths will be automatically prefixed with locale by next-intl middleware
const PUBLIC_PATH_PATTERNS = [
  "/login",
  "/usage-doc",
  "/status",
  "/api/auth/login",
  "/api/auth/logout",
];

const API_PROXY_PATH = "/v1";
const API_PROXY_BETA_PATH = "/v1beta";
const WORKSPACE_PROXY_BASE_PATTERN = /^(.*?\/proxy\/\d+)(?=\/|$)/;

function matchesPublicPath(pathname: string, pattern: string) {
  return pathname === pattern || pathname.startsWith(`${pattern}/`);
}

// Create next-intl middleware for locale detection and routing
const intlMiddleware = createMiddleware(routing);

function getVscodeProxyUri(): string {
  return process.env.VSCODE_PROXY_URI || process.env.vscode_proxy_uri || "";
}

function getVscodeProxyPort(): string {
  return process.env.PORT || "3000";
}

function normalizeBasePath(value: string | null | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "";
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed.slice(1))) {
    return "";
  }

  return trimmed;
}

function stripProxyBaseForLoginFrom(pathname: string): string {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const wsIndex = normalizedPathname.indexOf("/ws-");
  const candidate =
    wsIndex > 0 && normalizedPathname.slice(0, wsIndex).includes("/proxy/")
      ? normalizedPathname.slice(wsIndex)
      : normalizedPathname;

  const proxyBaseMatch = candidate.match(WORKSPACE_PROXY_BASE_PATTERN);
  if (!proxyBaseMatch) {
    return pathname;
  }

  const suffix = candidate.slice(proxyBaseMatch[1].length);
  return suffix || "/";
}

function normalizeLoginFromPath(pathname: string, fallbackPath: string): string {
  return normalizePathnameForLocaleNavigation(stripProxyBaseForLoginFrom(pathname), fallbackPath);
}

function buildLoginPath(locale: string, from: string): string {
  const params = new URLSearchParams();
  params.set("from", from);
  return `/${locale}/login?${params.toString()}`;
}

function extractWorkspaceProxyBasePath(pathname: string | null | undefined): string {
  if (!pathname) {
    return "";
  }

  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const wsIndex = normalizedPathname.indexOf("/ws-");
  if (wsIndex < 0) {
    return "";
  }

  const workspacePath = normalizedPathname.slice(wsIndex);
  const workspaceProxyMatch = workspacePath.match(WORKSPACE_PROXY_BASE_PATTERN);
  return normalizeBasePath(workspaceProxyMatch?.[1]);
}

function getVscodeProxyBasePath(): string {
  const vscodeProxyUri = getVscodeProxyUri();
  if (!vscodeProxyUri) {
    return "";
  }

  const resolvedUri = vscodeProxyUri.replaceAll("{{port}}", getVscodeProxyPort());
  try {
    return extractWorkspaceProxyBasePath(new URL(resolvedUri).pathname);
  } catch {
    const pathname = resolvedUri.startsWith("/")
      ? resolvedUri
      : new URL(resolvedUri, "http://localhost").pathname;
    return extractWorkspaceProxyBasePath(pathname);
  }
}

function getTrustedRefererPath(request: NextRequest): string {
  const referer = request.headers.get("referer");
  if (!referer) {
    return "";
  }

  try {
    const refererUrl = new URL(referer);
    const requestOrigin = request.nextUrl.origin;
    if (refererUrl.origin === requestOrigin) {
      return refererUrl.pathname;
    }

    const vscodeProxyUri = getVscodeProxyUri();
    if (vscodeProxyUri) {
      const vscodeProxyOrigin = new URL(vscodeProxyUri.replaceAll("{{port}}", getVscodeProxyPort()))
        .origin;
      if (refererUrl.origin === vscodeProxyOrigin) {
        return refererUrl.pathname;
      }
    }
  } catch {
    return "";
  }

  return "";
}

function chooseRicherBasePath(paths: string[]): string {
  const normalized = paths.map(normalizeBasePath).filter(Boolean);
  normalized.sort((a, b) => b.length - a.length);
  return normalized[0] ?? "";
}

function buildRelativeRedirectHtml(targetPath: string): NextResponse {
  const body = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
</head>
<body>
<script>
(function () {
  var targetPath = ${JSON.stringify(targetPath)};

  function normalizeRedirectPath(pathname) {
    var sourcePath = String(pathname || "");
    var wsIndex = sourcePath.indexOf("/ws-");
    var candidate = wsIndex >= 0 ? sourcePath.slice(wsIndex) : sourcePath;
    var match = candidate.match(/^(.*?\\/proxy\\/\\d+)(?:\\/|$)/);
    return match ? match[1] : "";
  }

  var currentPath = normalizeRedirectPath(window.location.pathname);
  var targetBasePath = normalizeRedirectPath(targetPath);
  var fullPath = currentPath && !targetBasePath
    ? currentPath + targetPath
    : targetPath;
  window.location.replace(fullPath);
})();
</script>
</body>
</html>`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function buildPlainLoginRedirectResponse(
  request: NextRequest,
  locale: string,
  from: string
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/login`;
  url.search = "";
  url.searchParams.set("from", from);
  return NextResponse.redirect(url);
}

function buildLoginRedirectResponse(
  request: NextRequest,
  locale: string,
  from: string
): NextResponse {
  if (!isSiiProxySupportEnabled()) {
    return buildPlainLoginRedirectResponse(request, locale, from);
  }

  const loginPath = buildLoginPath(locale, from);
  const vscodeProxyUri = getVscodeProxyUri();

  if (vscodeProxyUri) {
    const requestBasePath = extractWorkspaceProxyBasePath(request.nextUrl.pathname);
    const refererBasePath = extractWorkspaceProxyBasePath(getTrustedRefererPath(request));
    const envBasePath = getVscodeProxyBasePath();
    const recoveredBasePath = chooseRicherBasePath([refererBasePath, requestBasePath, envBasePath]);
    const targetPath = recoveredBasePath ? `${recoveredBasePath}${loginPath}` : loginPath;
    return buildRelativeRedirectHtml(targetPath);
  }

  return buildPlainLoginRedirectResponse(request, locale, from);
}

function buildWorkspaceBasePathForRequest(request: NextRequest): string {
  if (!isSiiProxySupportEnabled()) {
    return "";
  }

  return chooseRicherBasePath([
    extractWorkspaceProxyBasePath(getTrustedRefererPath(request)),
    extractWorkspaceProxyBasePath(request.nextUrl.pathname),
    getVscodeProxyBasePath(),
  ]);
}

function setWorkspaceBasePathHeader(requestHeaders: Headers, request: NextRequest): void {
  const workspaceBasePath = buildWorkspaceBasePathForRequest(request);
  if (workspaceBasePath) {
    requestHeaders.set(WORKSPACE_BASE_PATH_HEADER, workspaceBasePath);
  } else {
    requestHeaders.delete(WORKSPACE_BASE_PATH_HEADER);
  }
}

function proxyHandler(request: NextRequest) {
  const method = request.method;
  const pathname = request.nextUrl.pathname;
  const siiProxySupportEnabled = isSiiProxySupportEnabled();
  const appPathname = siiProxySupportEnabled ? stripProxyBaseForLoginFrom(pathname) : pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-cch-public-status");
  setWorkspaceBasePathHeader(requestHeaders, request);
  const sanitizedRequest = {
    ...request,
    headers: requestHeaders,
    cookies: request.cookies,
  } as NextRequest;

  if (isDevelopment()) {
    logger.info("Request received", { method: method.toUpperCase(), pathname });
  }

  // API 代理路由不需要 locale 处理和 Web 鉴权（使用自己的 Bearer token）
  if (
    pathname.startsWith(API_PROXY_PATH) ||
    pathname.startsWith(API_PROXY_BETA_PATH) ||
    (siiProxySupportEnabled &&
      (appPathname.startsWith(API_PROXY_PATH) || appPathname.startsWith(API_PROXY_BETA_PATH)))
  ) {
    return NextResponse.next();
  }

  const isLocalePrefixedPublicStatusPath = routing.locales.some(
    (locale) => appPathname === `/${locale}/status` || appPathname.startsWith(`/${locale}/status/`)
  );
  if (isLocalePrefixedPublicStatusPath) {
    requestHeaders.set("x-cch-public-status", "1");
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Skip locale handling for static files and Next.js internals
  if (appPathname.startsWith("/_next") || appPathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Apply locale middleware first (handles locale detection and routing)
  const localeResponse = intlMiddleware(sanitizedRequest);

  const isExplicitPublicStatusPath =
    appPathname === "/status" || appPathname.startsWith("/status/");

  if (isExplicitPublicStatusPath) {
    return localeResponse;
  }

  // Extract locale from pathname (format: /[locale]/path or just /path)
  const localeMatch = appPathname.match(/^\/([^/]+)/);
  const potentialLocale = localeMatch?.[1];
  const isLocaleInPath = routing.locales.includes(potentialLocale as Locale);

  // Get the pathname without locale prefix
  // When isLocaleInPath is true, potentialLocale is guaranteed to be defined
  const pathWithoutLocale = isLocaleInPath
    ? appPathname.slice((potentialLocale?.length ?? 0) + 1)
    : appPathname;

  // Check if current path (without locale) is a public path
  const isPublicPath = PUBLIC_PATH_PATTERNS.some((pattern) =>
    matchesPublicPath(pathWithoutLocale, pattern)
  );
  // Public paths don't require authentication
  if (isPublicPath) {
    return localeResponse;
  }

  // Check authentication for protected routes (cookie existence only).
  // Full session validation (Redis lookup, key permissions, expiry) is handled
  // by downstream layouts (dashboard/layout.tsx, etc.) which run in Node.js
  // runtime with guaranteed Redis/DB access. This avoids a death loop where
  // the proxy deletes the cookie on transient validation failures.
  const authToken = sanitizedRequest.cookies.get(AUTH_COOKIE_NAME);

  if (!authToken) {
    // Preserve locale in redirect
    const localeFromCookie = getLocaleFromValue(
      sanitizedRequest.cookies.get(localeCookieName)?.value
    );
    const locale =
      isLocaleInPath && potentialLocale
        ? potentialLocale
        : localeFromCookie || routing.defaultLocale;
    const from = siiProxySupportEnabled
      ? normalizeLoginFromPath(appPathname, pathWithoutLocale)
      : normalizePathnameForLocaleNavigation(pathWithoutLocale);
    return buildLoginRedirectResponse(request, locale, from);
  }

  // Cookie exists - pass through to layout for full validation
  return localeResponse;
}

// Default export required for Next.js 16 proxy file
export default proxyHandler;

export { matchesPublicPath };

export const config = {
  // KEEP IN SYNC with `src/proxy.matcher.ts` — must be a string literal here
  // so Next.js's build-time static analyzer can collect it. The unit test
  // `tests/unit/proxy-matcher.test.ts` asserts the two stay in sync. See the
  // matcher module for the full per-segment rationale.
  matcher: ["/((?!api|v1(?:/|$)|v1beta(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
