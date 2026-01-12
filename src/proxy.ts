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

/**
 * Build redirect URL that respects reverse proxy paths.
 *
 * When running behind a reverse proxy with a dynamic base path (e.g., containing UUIDs),
 * we need to handle redirects carefully. The issue is:
 * - request.nextUrl only sees the path as received by Next.js server (e.g., /zh-CN/dashboard)
 * - The actual client URL may have a long prefix path from the proxy
 *   (e.g., /ws-xxx/.../proxy/3000/zh-CN/dashboard)
 *
 * Solution: Use a relative path without leading slash. When the browser receives
 * Location: "zh-CN/login" (no leading slash), it resolves it relative to the current
 * directory, preserving the proxy prefix.
 *
 * Example:
 * - Current URL: https://example.com/ws-xxx/proxy/3000/
 * - Location header: zh-CN/login?from=/dashboard
 * - Browser navigates to: https://example.com/ws-xxx/proxy/3000/zh-CN/login?from=/dashboard
 */
function createRelativeRedirect(
  request: NextRequest,
  targetPath: string,
  searchParams?: URLSearchParams
): Response {
  // Build the full URL using the request's origin
  const url = new URL(targetPath, request.url);
  if (searchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  // Extract just the path portion (without origin) for the redirect
  // Use "./" prefix to make it a relative path that browsers resolve correctly
  const pathWithSearch = url.pathname + url.search;
  const relativePath = "." + pathWithSearch;

  // Use HTML meta refresh for client-side redirect
  // This avoids Next.js URL validation on the Location header
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${relativePath}">
<script>window.location.replace("${relativePath}");</script>
</head>
<body>Redirecting...</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/**
 * Convert absolute redirect to relative redirect for proxy compatibility.
 *
 * When next-intl middleware returns a redirect (e.g., / -> /zh-CN/),
 * we need to convert it to a relative path to work with reverse proxies.
 */
function convertToRelativeRedirect(response: NextResponse): Response {
  const location = response.headers.get("Location");
  if (!location) {
    return response;
  }

  // Check if it's a redirect response (3xx status)
  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  // Parse the location to check if it's an absolute path
  try {
    // If location is a full URL, extract just the path
    const url = new URL(location, "http://dummy");
    const path = url.pathname + url.search;

    // Convert to relative path with "./" prefix
    // This makes browsers resolve it relative to current directory
    const relativePath = "." + path;

    // Use HTML meta refresh for client-side redirect
    // This avoids Next.js URL validation on the Location header
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${relativePath}">
<script>window.location.replace("${relativePath}");</script>
</head>
<body>Redirecting...</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch {
    // If parsing fails, return original response
    return response;
  }
}

async function proxyHandler(request: NextRequest) {
  const method = request.method;
  const pathname = request.nextUrl.pathname;

  if (isDevelopment()) {
    logger.info("Request received", { method: method.toUpperCase(), pathname });
  }

  // API proxy routes don't need locale handling and Web auth (use their own Bearer token)
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
    // Not authenticated, redirect to login page
    // Preserve locale in redirect
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    const loginPath = `/${locale}/login`;
    const searchParams = new URLSearchParams();
    searchParams.set("from", pathWithoutLocale || "/dashboard");
    return createRelativeRedirect(request, loginPath, searchParams);
  }

  // Validate key permissions (canLoginWebUi, isEnabled, expiresAt, etc.)
  const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
  if (!session) {
    // Invalid key or insufficient permissions, clear cookie and redirect to login
    // Preserve locale in redirect
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    const loginPath = `/${locale}/login`;
    const searchParams = new URLSearchParams();
    searchParams.set("from", pathWithoutLocale || "/dashboard");

    // Build the full URL using the request's origin
    const url = new URL(loginPath, request.url);
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    // Extract just the path portion for the redirect
    const pathWithSearch = url.pathname + url.search;
    const relativePath = "." + pathWithSearch;

    // Use HTML meta refresh for client-side redirect with Set-Cookie to clear auth-token
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${relativePath}">
<script>window.location.replace("${relativePath}");</script>
</head>
<body>Redirecting...</body>
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
