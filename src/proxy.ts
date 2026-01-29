import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import type { Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { validateKey } from "@/lib/auth";
import { isDevelopment } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

// Public paths that don't require authentication
// Note: These paths will be automatically prefixed with locale by next-intl middleware
const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];

// Paths that allow read-only access (for canLoginWebUi=false keys)
// These paths bypass the canLoginWebUi check in validateKey
const READ_ONLY_PATH_PATTERNS = ["/my-usage"];

const API_PROXY_PATH = "/v1";

// Create next-intl middleware for locale detection and routing
const intlMiddleware = createMiddleware(routing);

function createRelativeRedirect(
  _request: NextRequest,
  targetPath: string,
  searchParams?: URLSearchParams
): Response {
  let fullTargetPath = targetPath;
  if (searchParams?.toString()) {
    fullTargetPath += `?${searchParams.toString()}`;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
(function() {
  var targetPath = ${JSON.stringify(fullTargetPath)};
  var locales = ["zh-CN", "zh-TW", "en", "ja", "ru"];
  var appRoutes = ["/dashboard", "/settings", "/login", "/logout", "/my-usage", "/usage-doc", "/internal", "/api", "/v1", "/v1beta", "/_next"];
  var currentPath = window.location.pathname;
  var basePath = "";

  function cleanBasePath(path) {
    if (!path) return "";
    var earliestAppRouteIdx = -1;

    for (var i = 0; i < appRoutes.length; i++) {
      var route = appRoutes[i];
      var routeIdx = path.indexOf(route);
      if (routeIdx !== -1 && (earliestAppRouteIdx === -1 || routeIdx < earliestAppRouteIdx)) {
        earliestAppRouteIdx = routeIdx;
      }
    }

    for (var j = 0; j < locales.length; j++) {
      var localePattern = "/" + locales[j];
      var localeIdx = path.indexOf(localePattern);
      if (localeIdx !== -1 && (earliestAppRouteIdx === -1 || localeIdx < earliestAppRouteIdx)) {
        var afterLocale = path.substring(localeIdx + localePattern.length);
        if (afterLocale === "" || afterLocale.charAt(0) === "/") {
          earliestAppRouteIdx = localeIdx;
        }
      }
    }

    if (earliestAppRouteIdx >= 0) {
      return path.substring(0, earliestAppRouteIdx);
    }

    return path;
  }

  var proxyMatch = currentPath.match(/^(.*?\\/proxy\\/\\d+)(?:\\/|$)/);
  if (proxyMatch) {
    basePath = proxyMatch[1];
  }

  if (!basePath) {
    for (var k = 0; k < locales.length; k++) {
      var localePattern = "/" + locales[k];
      var idx = currentPath.indexOf(localePattern);
      if (idx !== -1) {
        var afterLocale = currentPath.substring(idx + localePattern.length);
        if (afterLocale === "" || afterLocale.charAt(0) === "/") {
          basePath = currentPath.substring(0, idx);
          break;
        }
      }
    }
  }

  if (!basePath) {
    var knownPaths = ["/api/", "/v1/", "/_next/"];
    for (var j = 0; j < knownPaths.length; j++) {
      var idx2 = currentPath.indexOf(knownPaths[j]);
      if (idx2 > 0) {
        basePath = currentPath.substring(0, idx2);
        break;
      }
    }
  }

  if (!basePath && currentPath.length > 1) {
    var pathWithoutTrailingSlash = currentPath.replace(/\\/+$/, "");
    if (pathWithoutTrailingSlash &&
        !pathWithoutTrailingSlash.match(/^\\/(zh-CN|zh-TW|en|ja|ru|api|v1|_next)(\\/|$)/)) {
      basePath = pathWithoutTrailingSlash;
    }
  }

  basePath = cleanBasePath(basePath);

  var fullPath = basePath + targetPath;
  window.location.replace(fullPath);
})();
</script>
<noscript>
<meta http-equiv="refresh" content="0;url=${fullTargetPath}">
</noscript>
</head>
<body></body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function convertToRelativeRedirect(response: NextResponse): Response {
  const location = response.headers.get("Location");
  if (!location) {
    return response;
  }

  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  try {
    const url = new URL(location, "http://dummy");
    const targetPath = url.pathname + url.search;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
(function() {
  var targetPath = ${JSON.stringify(targetPath)};
  var locales = ["zh-CN", "zh-TW", "en", "ja", "ru"];
  var appRoutes = ["/dashboard", "/settings", "/login", "/logout", "/my-usage", "/usage-doc", "/internal", "/api", "/v1", "/v1beta", "/_next"];
  var currentPath = window.location.pathname;
  var basePath = "";

  function cleanBasePath(path) {
    if (!path) return "";
    var earliestAppRouteIdx = -1;

    for (var i = 0; i < appRoutes.length; i++) {
      var route = appRoutes[i];
      var routeIdx = path.indexOf(route);
      if (routeIdx !== -1 && (earliestAppRouteIdx === -1 || routeIdx < earliestAppRouteIdx)) {
        earliestAppRouteIdx = routeIdx;
      }
    }

    for (var j = 0; j < locales.length; j++) {
      var localePattern = "/" + locales[j];
      var localeIdx = path.indexOf(localePattern);
      if (localeIdx !== -1 && (earliestAppRouteIdx === -1 || localeIdx < earliestAppRouteIdx)) {
        var afterLocale = path.substring(localeIdx + localePattern.length);
        if (afterLocale === "" || afterLocale.charAt(0) === "/") {
          earliestAppRouteIdx = localeIdx;
        }
      }
    }

    if (earliestAppRouteIdx >= 0) {
      return path.substring(0, earliestAppRouteIdx);
    }

    return path;
  }

  var proxyMatch = currentPath.match(/^(.*?\\/proxy\\/\\d+)(?:\\/|$)/);
  if (proxyMatch) {
    basePath = proxyMatch[1];
  }

  if (!basePath) {
    for (var k = 0; k < locales.length; k++) {
      var localePattern = "/" + locales[k];
      var idx = currentPath.indexOf(localePattern);
      if (idx !== -1) {
        var afterLocale = currentPath.substring(idx + localePattern.length);
        if (afterLocale === "" || afterLocale.charAt(0) === "/") {
          basePath = currentPath.substring(0, idx);
          break;
        }
      }
    }
  }

  if (!basePath) {
    var knownPaths = ["/api/", "/v1/", "/_next/"];
    for (var j = 0; j < knownPaths.length; j++) {
      var idx2 = currentPath.indexOf(knownPaths[j]);
      if (idx2 > 0) {
        basePath = currentPath.substring(0, idx2);
        break;
      }
    }
  }

  if (!basePath && currentPath.length > 1) {
    var pathWithoutTrailingSlash = currentPath.replace(/\\/+$/, "");
    if (pathWithoutTrailingSlash &&
        !pathWithoutTrailingSlash.match(/^\\/(zh-CN|zh-TW|en|ja|ru|api|v1|_next)(\\/|$)/)) {
      basePath = pathWithoutTrailingSlash;
    }
  }

  basePath = cleanBasePath(basePath);

  var fullPath = basePath + targetPath;
  window.location.replace(fullPath);
})();
</script>
<noscript>
<meta http-equiv="refresh" content="0;url=${targetPath}">
</noscript>
</head>
<body></body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch {
    return response;
  }
}

async function proxyHandler(request: NextRequest) {
  const method = request.method;
  const pathname = request.nextUrl.pathname;

  if (isDevelopment()) {
    logger.info("Request received", { method: method.toUpperCase(), pathname });
  }

  // API 代理路由不需要 locale 处理和 Web 鉴权（使用自己的 Bearer token）
  if (pathname.startsWith(API_PROXY_PATH)) {
    return NextResponse.next();
  }

  // Skip locale handling for static files and Next.js internals
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Apply locale middleware first (handles locale detection and routing)
  const localeResponse = intlMiddleware(request);

  // Extract locale from pathname (format: /[locale]/path or just /path)
  const localeMatch = pathname.match(/^\/([^/]+)/);
  const potentialLocale = localeMatch?.[1];
  const isLocaleInPath = routing.locales.includes(potentialLocale as Locale);

  // Get the pathname without locale prefix
  // When isLocaleInPath is true, potentialLocale is guaranteed to be defined
  const pathWithoutLocale = isLocaleInPath
    ? pathname.slice((potentialLocale?.length ?? 0) + 1)
    : pathname;

  // Check if current path (without locale) is a public path
  const isPublicPath = PUBLIC_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(pattern)
  );

  // Public paths don't require authentication
  if (isPublicPath) {
    return convertToRelativeRedirect(localeResponse);
  }

  // Check if current path allows read-only access (for canLoginWebUi=false keys)
  const isReadOnlyPath = READ_ONLY_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(`${pattern}/`)
  );

  // Check authentication for protected routes
  const authToken = request.cookies.get("auth-token");

  if (!authToken) {
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    const loginPath = `/${locale}/login`;
    const searchParams = new URLSearchParams();
    searchParams.set("from", pathWithoutLocale || "/dashboard");
    return createRelativeRedirect(request, loginPath, searchParams);
  }

  // Validate key permissions (canLoginWebUi, isEnabled, expiresAt, etc.)
  const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
  if (!session) {
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    const loginPath = `/${locale}/login`;
    const searchParams = new URLSearchParams();
    searchParams.set("from", pathWithoutLocale || "/dashboard");

    const fullTargetPath = `${loginPath}?${searchParams.toString()}`;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
(function() {
  var targetPath = ${JSON.stringify(fullTargetPath)};
  var locales = ["zh-CN", "zh-TW", "en", "ja", "ru"];
  var appRoutes = ["/dashboard", "/settings", "/login", "/logout", "/my-usage", "/usage-doc", "/internal", "/api", "/v1", "/v1beta", "/_next"];
  var currentPath = window.location.pathname;
  var basePath = "";

  function cleanBasePath(path) {
    if (!path) return "";
    var earliestAppRouteIdx = -1;

    for (var i = 0; i < appRoutes.length; i++) {
      var route = appRoutes[i];
      var routeIdx = path.indexOf(route);
      if (routeIdx !== -1 && (earliestAppRouteIdx === -1 || routeIdx < earliestAppRouteIdx)) {
        earliestAppRouteIdx = routeIdx;
      }
    }

    for (var j = 0; j < locales.length; j++) {
      var localePattern = "/" + locales[j];
      var localeIdx = path.indexOf(localePattern);
      if (localeIdx !== -1 && (earliestAppRouteIdx === -1 || localeIdx < earliestAppRouteIdx)) {
        var afterLocale = path.substring(localeIdx + localePattern.length);
        if (afterLocale === "" || afterLocale.charAt(0) === "/") {
          earliestAppRouteIdx = localeIdx;
        }
      }
    }

    if (earliestAppRouteIdx >= 0) {
      return path.substring(0, earliestAppRouteIdx);
    }

    return path;
  }

  var proxyMatch = currentPath.match(/^(.*?\\/proxy\\/\\d+)(?:\\/|$)/);
  if (proxyMatch) {
    basePath = proxyMatch[1];
  }

  if (!basePath) {
    for (var k = 0; k < locales.length; k++) {
      var localePattern = "/" + locales[k];
      var idx = currentPath.indexOf(localePattern);
      if (idx !== -1) {
        var afterLocale = currentPath.substring(idx + localePattern.length);
        if (afterLocale === "" || afterLocale.charAt(0) === "/") {
          basePath = currentPath.substring(0, idx);
          break;
        }
      }
    }
  }

  if (!basePath) {
    var knownPaths = ["/api/", "/v1/", "/_next/"];
    for (var j = 0; j < knownPaths.length; j++) {
      var idx2 = currentPath.indexOf(knownPaths[j]);
      if (idx2 > 0) {
        basePath = currentPath.substring(0, idx2);
        break;
      }
    }
  }

  if (!basePath && currentPath.length > 1) {
    var pathWithoutTrailingSlash = currentPath.replace(/\\/+$/, "");
    if (pathWithoutTrailingSlash &&
        !pathWithoutTrailingSlash.match(/^\\/(zh-CN|zh-TW|en|ja|ru|api|v1|_next)(\\/|$)/)) {
      basePath = pathWithoutTrailingSlash;
    }
  }

  basePath = cleanBasePath(basePath);

  document.cookie = "auth-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

  var fullPath = basePath + targetPath;
  window.location.replace(fullPath);
})();
</script>
<noscript>
<meta http-equiv="refresh" content="0;url=${fullTargetPath}">
</noscript>
</head>
<body></body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": "auth-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      },
    });
  }

  // Authentication passed, return locale response
  return convertToRelativeRedirect(localeResponse);
}

// Default export required for Next.js 16 proxy file
export default proxyHandler;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes - handled separately)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
