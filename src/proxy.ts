import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import type { Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { validateKey } from "@/lib/auth";
import { isDevelopment } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];

const READ_ONLY_PATH_PATTERNS = ["/my-usage"];

const API_PROXY_PATH = "/v1";

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
  var currentPath = window.location.pathname;
  var basePath = "";

  for (var i = 0; i < locales.length; i++) {
    var localePattern = "/" + locales[i];
    var idx = currentPath.indexOf(localePattern);
    if (idx !== -1) {
      var afterLocale = currentPath.substring(idx + localePattern.length);
      if (afterLocale === "" || afterLocale.charAt(0) === "/") {
        basePath = currentPath.substring(0, idx);
        break;
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

  var fullPath = basePath + targetPath;
  window.location.replace(fullPath);
})();
</script>
<noscript>
<meta http-equiv="refresh" content="0;url=${fullTargetPath}">
</noscript>
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
  var currentPath = window.location.pathname;
  var basePath = "";

  for (var i = 0; i < locales.length; i++) {
    var localePattern = "/" + locales[i];
    var idx = currentPath.indexOf(localePattern);
    if (idx !== -1) {
      var afterLocale = currentPath.substring(idx + localePattern.length);
      if (afterLocale === "" || afterLocale.charAt(0) === "/") {
        basePath = currentPath.substring(0, idx);
        break;
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

  var fullPath = basePath + targetPath;
  window.location.replace(fullPath);
})();
</script>
<noscript>
<meta http-equiv="refresh" content="0;url=${targetPath}">
</noscript>
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
    return response;
  }
}

async function proxyHandler(request: NextRequest) {
  const method = request.method;
  const pathname = request.nextUrl.pathname;

  if (isDevelopment()) {
    logger.info("Request received", { method: method.toUpperCase(), pathname });
  }

  if (pathname.startsWith(API_PROXY_PATH)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const localeResponse = intlMiddleware(request);

  const localeMatch = pathname.match(/^\/([^/]+)/);
  const potentialLocale = localeMatch?.[1];
  const isLocaleInPath = routing.locales.includes(potentialLocale as Locale);

  const pathWithoutLocale = isLocaleInPath
    ? pathname.slice((potentialLocale?.length ?? 0) + 1)
    : pathname;

  const isPublicPath = PUBLIC_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(pattern)
  );

  if (isPublicPath) {
    return convertToRelativeRedirect(localeResponse);
  }

  const isReadOnlyPath = READ_ONLY_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(`${pattern}/`)
  );

  const authToken = request.cookies.get("auth-token");

  if (!authToken) {
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    const loginPath = `/${locale}/login`;
    const searchParams = new URLSearchParams();
    searchParams.set("from", pathWithoutLocale || "/dashboard");
    return createRelativeRedirect(request, loginPath, searchParams);
  }

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
  var currentPath = window.location.pathname;
  var basePath = "";

  for (var i = 0; i < locales.length; i++) {
    var localePattern = "/" + locales[i];
    var idx = currentPath.indexOf(localePattern);
    if (idx !== -1) {
      var afterLocale = currentPath.substring(idx + localePattern.length);
      if (afterLocale === "" || afterLocale.charAt(0) === "/") {
        basePath = currentPath.substring(0, idx);
        break;
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

  document.cookie = "auth-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

  var fullPath = basePath + targetPath;
  window.location.replace(fullPath);
})();
</script>
<noscript>
<meta http-equiv="refresh" content="0;url=${fullTargetPath}">
</noscript>
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

  return convertToRelativeRedirect(localeResponse);
}

export default proxyHandler;

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
