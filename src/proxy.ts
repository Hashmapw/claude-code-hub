import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { isDevelopment } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { WORKSPACE_BASE_PATH_HEADER } from "@/lib/utils/workspace-aware-redirect";

// Public paths that don't require authentication
// Note: These paths will be automatically prefixed with locale by next-intl middleware
const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];

const API_PROXY_PATH = "/v1";
const REQUEST_META = new WeakMap<
  NextRequest,
  {
    originalPathWithSearch: string;
    skipRefererRecovery: boolean;
    skipEnvCanonicalization: boolean;
  }
>();
const SUPPORTED_LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ru"] as const;
const APP_ROUTES = [
  "/dashboard",
  "/settings",
  "/login",
  "/logout",
  "/my-usage",
  "/usage-doc",
  "/internal",
  "/api",
  "/v1",
  "/v1beta",
  "/_next",
] as const;

// Create next-intl middleware for locale detection and routing
const intlMiddleware = createMiddleware(routing);
let cachedEnvProxyBasePath: string | undefined;

function isSegmentMatch(path: string, segment: string, index: number): boolean {
  if (index < 0) {
    return false;
  }
  if (index + segment.length > path.length) {
    return false;
  }

  const after = path[index + segment.length];
  return after === undefined || after === "/";
}

function findEarliestSegmentIndex(path: string, segment: string): number {
  let fromIndex = 0;
  while (fromIndex < path.length) {
    const idx = path.indexOf(segment, fromIndex);
    if (idx === -1) {
      return -1;
    }
    if (isSegmentMatch(path, segment, idx)) {
      return idx;
    }
    fromIndex = idx + 1;
  }
  return -1;
}

function collapseDuplicatedLeadingProxyPrefix(path: string): string {
  let current = path;
  for (let i = 0; i < 8; i++) {
    if (!current.startsWith("/proxy/")) {
      return current;
    }

    const firstProxyMatch = current.match(/^\/proxy\/(\d+)(?:\/|$)/);
    const firstPort = firstProxyMatch?.[1];
    if (!firstPort) {
      return current;
    }

    const firstPrefix = `/proxy/${firstPort}`;
    const rest = current.slice(firstPrefix.length);
    if (!rest.startsWith("/")) {
      return current;
    }

    // Some notebook gateways prepend /proxy/<port> in front of a full ws-... path.
    // If the first real segment is workspace id, strip this accidental leading prefix.
    if (/^\/ws-[^/]+(?:\/|$)/.test(rest)) {
      current = rest;
      continue;
    }

    const repeatedPattern = new RegExp(`/proxy/${firstPort}(?:/|$)`, "g");
    const repeatedMatches = [...current.matchAll(repeatedPattern)];
    if (repeatedMatches.length >= 2) {
      current = rest;
      continue;
    }

    return current;
  }

  return current;
}

function normalizeWorkspacePathWithLocale(pathname: string, locale: string): string {
  const workspaceProxyMatch = pathname.match(/^(.*?\/proxy\/\d+)(\/.*|$)/);
  if (!workspaceProxyMatch) {
    return pathname;
  }

  const workspaceBase = workspaceProxyMatch[1];
  const workspaceSuffix = workspaceProxyMatch[2] || "";
  if (workspaceSuffix === `/${locale}` || workspaceSuffix.startsWith(`/${locale}/`)) {
    return `${workspaceBase}${workspaceSuffix}`;
  }

  return `${workspaceBase}/${locale}${workspaceSuffix}`;
}

function stripPollutedPrefixBeforeWorkspace(pathname: string): {
  normalizedPath: string;
  leadingLocale: string | null;
} {
  const wsIndex = pathname.indexOf("/ws-");
  if (wsIndex <= 0) {
    return { normalizedPath: pathname, leadingLocale: null };
  }

  const prefix = pathname.slice(0, wsIndex);
  if (!/\/proxy\/\d+/.test(prefix)) {
    return { normalizedPath: pathname, leadingLocale: null };
  }

  const localeGroup = SUPPORTED_LOCALES.join("|");
  const localeMatch = prefix.match(new RegExp(`/(${localeGroup})(?:/)?$`));
  return {
    normalizedPath: pathname.slice(wsIndex),
    leadingLocale: localeMatch?.[1] ?? null,
  };
}

function normalizeLocaleLeadingWorkspacePath(pathname: string): string {
  const localeGroup = SUPPORTED_LOCALES.join("|");
  const localeLeadingWorkspaceMatch = pathname.match(
    new RegExp(`^/(${localeGroup})(/ws-[^/]+(?:/.*|$))`)
  );
  if (!localeLeadingWorkspaceMatch) {
    return pathname;
  }

  const locale = localeLeadingWorkspaceMatch[1];
  const workspacePath = localeLeadingWorkspaceMatch[2];
  if (!workspacePath || !/\/proxy\/\d+(?:\/|$)/.test(workspacePath)) {
    return pathname;
  }

  return normalizeWorkspacePathWithLocale(workspacePath, locale);
}

function hasKnownAppEntry(pathname: string): boolean {
  if (SUPPORTED_LOCALES.some((locale) => findEarliestSegmentIndex(pathname, `/${locale}`) !== -1)) {
    return true;
  }

  return APP_ROUTES.some((route) => findEarliestSegmentIndex(pathname, route) !== -1);
}

function normalizeDuplicatedProxyPrefixPath(pathname: string): string | null {
  if (!pathname.startsWith("/proxy/")) {
    return null;
  }

  const collapsed = collapseDuplicatedLeadingProxyPrefix(pathname);
  if (collapsed === pathname) {
    return null;
  }

  if (!hasKnownAppEntry(collapsed)) {
    return null;
  }

  return collapsed;
}

function extractLocaleContext(pathname: string): {
  locale: string;
  isLocaleInPath: boolean;
  pathWithoutLocale: string;
} {
  let bestLocale: string | null = null;
  let bestIdx = -1;

  for (const locale of routing.locales) {
    const idx = findEarliestSegmentIndex(pathname, `/${locale}`);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
      bestLocale = locale;
    }
  }

  if (bestLocale !== null && bestIdx !== -1) {
    const suffix = pathname.slice(bestIdx + bestLocale.length + 1);
    return {
      locale: bestLocale,
      isLocaleInPath: true,
      pathWithoutLocale: suffix || "/",
    };
  }

  return {
    locale: routing.defaultLocale,
    isLocaleInPath: false,
    pathWithoutLocale: pathname,
  };
}

function cleanBasePath(path: string): string {
  if (!path) {
    return "";
  }

  const normalizedPath = collapseDuplicatedLeadingProxyPrefix(path);
  let earliestIdx = -1;

  for (const route of APP_ROUTES) {
    const idx = findEarliestSegmentIndex(normalizedPath, route);
    if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
      earliestIdx = idx;
    }
  }

  for (const locale of SUPPORTED_LOCALES) {
    const localePattern = `/${locale}`;
    const idx = findEarliestSegmentIndex(normalizedPath, localePattern);
    if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
      earliestIdx = idx;
    }
  }

  if (earliestIdx >= 0) {
    return normalizedPath.substring(0, earliestIdx);
  }

  return normalizedPath;
}

function getEnvProxyBasePath(): string | null {
  if (cachedEnvProxyBasePath !== undefined) {
    return cachedEnvProxyBasePath || null;
  }

  const proxyUri = process.env.VSCODE_PROXY_URI || process.env.vscode_proxy_uri;
  if (!proxyUri) {
    cachedEnvProxyBasePath = "";
    return null;
  }

  try {
    const port = process.env.PORT || "3000";
    const resolvedUri = proxyUri.replaceAll("{{port}}", port).replace(/\/+$/, "");
    if (!resolvedUri) {
      cachedEnvProxyBasePath = "";
      return null;
    }

    let pathname: string;
    try {
      pathname = new URL(resolvedUri).pathname;
    } catch {
      pathname = resolvedUri.startsWith("/")
        ? resolvedUri
        : new URL(resolvedUri, "http://localhost").pathname;
    }

    const cleaned = cleanBasePath(pathname).replace(/\/+$/, "");
    cachedEnvProxyBasePath = cleaned || "";
    return cleaned || null;
  } catch {
    cachedEnvProxyBasePath = "";
    return null;
  }
}

function detectBasePathFromPath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "";
  }

  for (const locale of SUPPORTED_LOCALES) {
    const localePattern = `/${locale}`;
    const idx = findEarliestSegmentIndex(pathname, localePattern);
    if (idx > 0) {
      return cleanBasePath(pathname.substring(0, idx)).replace(/\/+$/, "");
    }
  }

  const knownPrefixes = ["/api/", "/v1/", "/_next/"];
  for (const knownPrefix of knownPrefixes) {
    const idx = pathname.indexOf(knownPrefix);
    if (idx > 0) {
      return cleanBasePath(pathname.substring(0, idx)).replace(/\/+$/, "");
    }
  }

  const proxyMatch = pathname.match(/^(.*?\/proxy\/\d+)(?:\/|$)/);
  if (proxyMatch?.[1]) {
    return cleanBasePath(proxyMatch[1]).replace(/\/+$/, "");
  }

  const pathWithoutTrailingSlash = pathname.replace(/\/+$/, "");
  if (
    pathWithoutTrailingSlash &&
    !pathWithoutTrailingSlash.match(/^\/(zh-CN|zh-TW|en|ja|ru|api|v1|_next)(\/|$)/)
  ) {
    return cleanBasePath(pathWithoutTrailingSlash);
  }

  return "";
}

function countPathSegments(pathname: string): number {
  if (!pathname) {
    return 0;
  }
  const normalized = pathname.replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return 0;
  }
  return normalized.split("/").length;
}

function getOriginalPathWithSearch(request: NextRequest): string {
  return (
    REQUEST_META.get(request)?.originalPathWithSearch ||
    `${request.nextUrl.pathname}${request.nextUrl.search || ""}`
  );
}

function shouldSkipSelfRedirect(request: NextRequest, targetPath: string): boolean {
  const originalPath = normalizeRedirectPath(getOriginalPathWithSearch(request));
  const targetWithSearch = targetPath.includes("?")
    ? targetPath
    : `${targetPath}${request.nextUrl.search || ""}`;
  const normalizedTarget = normalizeRedirectPath(targetWithSearch);
  return normalizedTarget === originalPath;
}

function shouldRecoverFromRefererBase(recoverPath: string, refererBasePath: string): boolean {
  const currentBasePath = detectBasePathFromPath(recoverPath);
  if (!currentBasePath) {
    return true;
  }

  if (currentBasePath === refererBasePath) {
    return false;
  }

  const currentSegments = countPathSegments(currentBasePath);
  const refererSegments = countPathSegments(refererBasePath);

  // Only recover when referer base path is strictly richer than current path base.
  return refererSegments > currentSegments;
}

function normalizeRedirectPath(pathWithOptionalSearch: string): string {
  if (!pathWithOptionalSearch) {
    return "/";
  }

  const queryIndex = pathWithOptionalSearch.indexOf("?");
  const pathname =
    (queryIndex === -1 ? pathWithOptionalSearch : pathWithOptionalSearch.slice(0, queryIndex)) ||
    "/";
  const search = queryIndex === -1 ? "" : pathWithOptionalSearch.slice(queryIndex);

  let normalizedPathname = collapseDuplicatedLeadingProxyPrefix(pathname);

  const pollutedMatch = normalizedPathname.match(/^\/proxy\/\d+(\/ws-[^/]+(?:\/.*|$))/);
  if (pollutedMatch?.[1]) {
    normalizedPathname = pollutedMatch[1];
  }

  const strippedWorkspacePath = stripPollutedPrefixBeforeWorkspace(normalizedPathname);
  normalizedPathname = strippedWorkspacePath.normalizedPath;
  if (strippedWorkspacePath.leadingLocale) {
    normalizedPathname = normalizeWorkspacePathWithLocale(
      normalizedPathname,
      strippedWorkspacePath.leadingLocale
    );
  }

  normalizedPathname = normalizeLocaleLeadingWorkspacePath(normalizedPathname);

  return `${normalizedPathname}${search}`;
}

function extractWorkspaceSegment(pathname: string): string | null {
  const match = pathname.match(/\/ws-[^/]+/);
  return match?.[0] ?? null;
}

function hasWorkspaceSegment(pathname: string): boolean {
  return /\/ws-[^/]+(?:\/|$)/.test(pathname);
}

function extractWorkspaceAppPath(pathname: string): string | null {
  if (!hasWorkspaceSegment(pathname)) {
    return null;
  }

  const workspaceProxyMatch = pathname.match(/\/proxy\/\d+(\/.*|$)/);
  if (!workspaceProxyMatch) {
    return null;
  }

  const suffixPath = workspaceProxyMatch[1] || "/";
  if (suffixPath === "/") {
    return null;
  }

  if (isNextInternalPath(suffixPath)) {
    return null;
  }

  if (isRootAppPath(suffixPath)) {
    return suffixPath;
  }

  return null;
}

function maybeCanonicalizePathWithEnvProxyBase(request: NextRequest): Response | null {
  if (REQUEST_META.get(request)?.skipEnvCanonicalization) {
    return null;
  }

  const pathname = request.nextUrl.pathname;
  // Workspace-prefixed paths should be normalized by path-based rules only.
  // Using env base path here can accidentally prepend /proxy/<port> before /ws-...
  if (pathname.includes("/ws-") || hasWorkspaceSegment(pathname)) {
    return null;
  }

  const envBasePath = getEnvProxyBasePath();
  if (!envBasePath) {
    return null;
  }

  const pathWorkspace = extractWorkspaceSegment(pathname);
  const envWorkspace = extractWorkspaceSegment(envBasePath);
  // If request already contains workspace segment but env base doesn't (or mismatches),
  // env-derived canonicalization is unreliable and may prepend /proxy/<port> before ws-.
  if (pathWorkspace && (!envWorkspace || envWorkspace !== pathWorkspace)) {
    return null;
  }

  if (pathname === envBasePath || pathname.startsWith(`${envBasePath}/`)) {
    return null;
  }

  // Strip any accidental leading prefix if the canonical env base path is embedded later in URL.
  const embeddedIdx = pathname.indexOf(envBasePath);
  if (embeddedIdx > 0) {
    const targetPath = pathname.slice(embeddedIdx);
    return reprocessWithCanonicalEnvPath(request, targetPath);
  }

  // Recover requests like /proxy/3000/zh-CN/... when env base is /ws-.../proxy/3000.
  const leadingProxyMatch = pathname.match(/^\/proxy\/\d+(\/.*|$)/);
  if (leadingProxyMatch && /\/proxy\/\d+$/.test(envBasePath)) {
    const suffixPath = leadingProxyMatch[1] || "/";
    if (isRootAppPath(suffixPath) || isNextInternalPath(suffixPath)) {
      const targetPath = `${envBasePath}${suffixPath}`;
      return reprocessWithCanonicalEnvPath(request, targetPath);
    }
  }

  // Recover root app/internal paths by prefixing canonical env base path.
  if (isRootAppPath(pathname) || isNextInternalPath(pathname)) {
    const targetPath = `${envBasePath}${pathname}`;
    return reprocessWithCanonicalEnvPath(request, targetPath);
  }

  return null;
}

function reprocessWithCanonicalEnvPath(request: NextRequest, targetPath: string): Response | null {
  if (shouldSkipSelfRedirect(request, targetPath)) {
    return null;
  }

  // Run canonicalization in-process to avoid external 307 Location headers.
  // Notebook gateways may rewrite Location into polluted /proxy/<port>/ws-... paths.
  const normalizedRequest = cloneRequestWithPathname(request, targetPath, {
    skipEnvCanonicalization: true,
  });
  return proxyHandler(normalizedRequest);
}

function isRootAppPath(pathname: string): boolean {
  if (
    SUPPORTED_LOCALES.some(
      (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)
    )
  ) {
    return true;
  }

  return APP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isNextInternalPath(pathname: string): boolean {
  return findEarliestSegmentIndex(pathname, "/_next") !== -1;
}

function extractNextInternalPath(pathname: string): string | null {
  const idx = findEarliestSegmentIndex(pathname, "/_next");
  if (idx === -1) {
    return null;
  }
  return pathname.slice(idx) || "/_next";
}

function maybeRestoreProxyPrefixFromReferer(request: NextRequest): string | null {
  if (REQUEST_META.get(request)?.skipRefererRecovery) {
    return null;
  }

  const pathname = request.nextUrl.pathname;

  // If pathname already contains workspace segment, it is already canonical (or recoverable
  // by other normalizers). Never downgrade it via referer-based recovery.
  if (hasWorkspaceSegment(pathname)) {
    return null;
  }

  let recoverPath = pathname;
  // Prefix recovery is meaningful for:
  // 1) root app/_next paths that lost middle ws prefix
  // 2) paths like /proxy/3000/zh-CN/... where ws segment is missing
  if (!isRootAppPath(recoverPath) && !isNextInternalPath(recoverPath)) {
    const leadingProxyMatch = recoverPath.match(/^\/proxy\/\d+(\/.*|$)/);
    if (!leadingProxyMatch) {
      return null;
    }

    const suffixPath = leadingProxyMatch[1] || "/";
    if (!isRootAppPath(suffixPath) && !isNextInternalPath(suffixPath)) {
      return null;
    }

    recoverPath = suffixPath;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }

  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
  } catch {
    return null;
  }

  const refererBasePath = detectBasePathFromPath(refererUrl.pathname);
  if (!refererBasePath) {
    return null;
  }

  if (pathname === refererBasePath || pathname.startsWith(`${refererBasePath}/`)) {
    return null;
  }
  if (recoverPath === refererBasePath || recoverPath.startsWith(`${refererBasePath}/`)) {
    return null;
  }
  if (!shouldRecoverFromRefererBase(recoverPath, refererBasePath)) {
    return null;
  }

  const restoredPathname = `${refererBasePath}${recoverPath}`;

  if (isDevelopment()) {
    logger.info("Recover proxy base path from referer", {
      pathname,
      recoverPath,
      refererPathname: refererUrl.pathname,
      restoredPathname,
    });
  }

  return restoredPathname;
}

function cloneRequestWithPathname(
  request: NextRequest,
  pathname: string,
  options?: { skipRefererRecovery?: boolean; skipEnvCanonicalization?: boolean }
): NextRequest {
  const normalizedUrl = request.nextUrl.clone();
  normalizedUrl.pathname = pathname;

  const existingMeta = REQUEST_META.get(request);
  const originalPathWithSearch =
    existingMeta?.originalPathWithSearch ||
    `${request.nextUrl.pathname}${request.nextUrl.search || ""}`;
  const skipRefererRecovery =
    options?.skipRefererRecovery === true || existingMeta?.skipRefererRecovery === true;
  const skipEnvCanonicalization =
    options?.skipEnvCanonicalization === true || existingMeta?.skipEnvCanonicalization === true;

  const canUseNativeClone =
    typeof (request as unknown as { arrayBuffer?: unknown }).arrayBuffer === "function";

  const normalizedRequest = canUseNativeClone
    ? new NextRequest(normalizedUrl, request as unknown as Request)
    : (() => {
        const fallbackRequest = Object.create(request) as NextRequest;
        Object.defineProperty(fallbackRequest, "nextUrl", {
          value: normalizedUrl,
          enumerable: true,
          configurable: true,
        });
        Object.defineProperty(fallbackRequest, "url", {
          value: normalizedUrl.toString(),
          enumerable: true,
          configurable: true,
        });
        return fallbackRequest;
      })();
  REQUEST_META.set(normalizedRequest, {
    originalPathWithSearch,
    skipRefererRecovery,
    skipEnvCanonicalization,
  });

  return normalizedRequest;
}

function buildRelativeRedirectHtml(
  targetPath: string,
  options?: { noScriptTarget?: string; clearAuthCookie?: boolean }
): string {
  const noScriptTarget = options?.noScriptTarget ?? targetPath;
  const clearAuthCookieScript = options?.clearAuthCookie
    ? `  document.cookie = ${JSON.stringify(`${AUTH_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`)};\n`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
(function() {
  var targetPath = ${JSON.stringify(targetPath)};
  var locales = ["zh-CN", "zh-TW", "en", "ja", "ru"];
  var appRoutes = [
    "/dashboard",
    "/settings",
    "/login",
    "/logout",
    "/my-usage",
    "/usage-doc",
    "/internal",
    "/api",
    "/v1",
    "/v1beta",
    "/_next"
  ];
  var currentPath = normalizeRedirectPath(window.location.pathname);
  var basePath = "";

  function collapseDuplicatedLeadingProxyPrefix(pathValue) {
    var current = pathValue || "";
    for (var idxLoop = 0; idxLoop < 8; idxLoop++) {
      if (!current || current.indexOf("/proxy/") !== 0) {
        return current;
      }

      var firstProxyMatch = current.match(/^\\/proxy\\/(\\d+)(?:\\/|$)/);
      var firstPort = firstProxyMatch && firstProxyMatch[1];
      if (!firstPort) {
        return current;
      }

      var firstPrefix = "/proxy/" + firstPort;
      var rest = current.substring(firstPrefix.length);
      if (!rest || rest.charAt(0) !== "/") {
        return current;
      }

      if (/^\\/ws-[^/]+(?:\\/|$)/.test(rest)) {
        current = rest;
        continue;
      }

      var repeatedPattern = new RegExp("/proxy/" + firstPort + "(?:/|$)", "g");
      var repeatedMatches = current.match(repeatedPattern) || [];
      if (repeatedMatches.length >= 2) {
        current = rest;
        continue;
      }

      return current;
    }

    return current;
  }

  function normalizeWorkspacePathWithLocale(pathValue, locale) {
    var workspaceProxyMatch = pathValue.match(new RegExp("^(.*?/proxy/\\\\d+)(/.*|$)"));
    if (!workspaceProxyMatch) {
      return pathValue;
    }

    var workspaceBase = workspaceProxyMatch[1];
    var workspaceSuffix = workspaceProxyMatch[2] || "";
    if (workspaceSuffix === "/" + locale || workspaceSuffix.indexOf("/" + locale + "/") === 0) {
      return workspaceBase + workspaceSuffix;
    }

    return workspaceBase + "/" + locale + workspaceSuffix;
  }

  function stripPollutedPrefixBeforeWorkspace(pathValue) {
    var wsIndex = pathValue.indexOf("/ws-");
    if (wsIndex <= 0) {
      return { normalizedPath: pathValue, leadingLocale: null };
    }

    var prefix = pathValue.substring(0, wsIndex);
    var pollutedPrefixPattern = new RegExp("/proxy/\\\\d+");
    if (!pollutedPrefixPattern.test(prefix)) {
      return { normalizedPath: pathValue, leadingLocale: null };
    }

    var localeGroup = "(zh-CN|zh-TW|en|ja|ru)";
    var localeMatch = prefix.match(new RegExp("/" + localeGroup + "(?:/)?$"));
    return {
      normalizedPath: pathValue.substring(wsIndex),
      leadingLocale: localeMatch && localeMatch[1] ? localeMatch[1] : null
    };
  }

  function normalizeLocaleLeadingWorkspacePath(pathValue) {
    if (!pathValue) return pathValue;

    var localeGroup = "(zh-CN|zh-TW|en|ja|ru)";
    var localeLeadingWorkspacePattern = new RegExp("^/" + localeGroup + "(/ws-[^/]+(?:/.*|$))");
    var localeLeadingWorkspaceMatch = pathValue.match(localeLeadingWorkspacePattern);
    if (!localeLeadingWorkspaceMatch) {
      return pathValue;
    }

    var localePattern = new RegExp("^/" + localeGroup);
    var localeMatch = pathValue.match(localePattern);
    var locale = localeMatch && localeMatch[1];
    var workspacePath = localeLeadingWorkspaceMatch[2];
    var workspaceProxyPattern = new RegExp("/proxy/\\\\d+(?:/|$)");
    if (!locale || !workspacePath || !workspaceProxyPattern.test(workspacePath)) {
      return pathValue;
    }

    return normalizeWorkspacePathWithLocale(workspacePath, locale);
  }

  function normalizeRedirectPath(pathValue) {
    if (!pathValue) return "/";

    var qIndex = pathValue.indexOf("?");
    var pathname = qIndex === -1 ? pathValue : pathValue.substring(0, qIndex);
    var search = qIndex === -1 ? "" : pathValue.substring(qIndex);

    pathname = pathname || "/";
    pathname = collapseDuplicatedLeadingProxyPrefix(pathname);

    var pollutedPattern = new RegExp("^/proxy/\\\\d+(/ws-[^/]+(?:/.*|$))");
    var pollutedMatch = pathname.match(pollutedPattern);
    if (pollutedMatch && pollutedMatch[1]) {
      pathname = pollutedMatch[1];
    }

    var strippedWorkspacePath = stripPollutedPrefixBeforeWorkspace(pathname);
    pathname = strippedWorkspacePath.normalizedPath;
    if (strippedWorkspacePath.leadingLocale) {
      pathname = normalizeWorkspacePathWithLocale(pathname, strippedWorkspacePath.leadingLocale);
    }

    pathname = normalizeLocaleLeadingWorkspacePath(pathname);

    return pathname + search;
  }

  targetPath = normalizeRedirectPath(targetPath);

  function cleanBasePath(path) {
    if (!path) return "";

    path = collapseDuplicatedLeadingProxyPrefix(path);
    var earliestIdx = -1;
    function isSegmentMatch(pathValue, segment, index) {
      if (index < 0) return false;
      if (index + segment.length > pathValue.length) return false;
      var after = pathValue.charAt(index + segment.length);
      return !after || after === "/";
    }
    function findEarliestSegmentIndex(pathValue, segment) {
      var fromIndex = 0;
      while (fromIndex < pathValue.length) {
        var idx = pathValue.indexOf(segment, fromIndex);
        if (idx === -1) return -1;
        if (isSegmentMatch(pathValue, segment, idx)) return idx;
        fromIndex = idx + 1;
      }
      return -1;
    }

    for (var i = 0; i < appRoutes.length; i++) {
      var routeIdx = findEarliestSegmentIndex(path, appRoutes[i]);
      if (routeIdx !== -1 && (earliestIdx === -1 || routeIdx < earliestIdx)) {
        earliestIdx = routeIdx;
      }
    }

    for (var j = 0; j < locales.length; j++) {
      var localePattern = "/" + locales[j];
      var localeIdx = findEarliestSegmentIndex(path, localePattern);
      if (localeIdx !== -1 && (earliestIdx === -1 || localeIdx < earliestIdx)) {
        earliestIdx = localeIdx;
      }
    }

    if (earliestIdx >= 0) {
      return path.substring(0, earliestIdx);
    }

    return path;
  }

  function getPathname(pathWithSearch) {
    var qIndex = pathWithSearch.indexOf("?");
    return qIndex === -1 ? pathWithSearch : pathWithSearch.substring(0, qIndex);
  }

  function countSegments(pathValue) {
    if (!pathValue) return 0;
    var normalized = pathValue.replace(/^\\/+|\\/+$/g, "");
    if (!normalized) return 0;
    return normalized.split("/").length;
  }

  function startsWithSegment(pathValue, prefix) {
    return pathValue === prefix || pathValue.indexOf(prefix + "/") === 0;
  }

  function detectBasePathFromPath(pathValue) {
    if (!pathValue || pathValue === "/") return "";

    var pathname = getPathname(pathValue);
    function isSegmentMatch2(pathnameValue, segment, index) {
      if (index < 0) return false;
      if (index + segment.length > pathnameValue.length) return false;
      var after = pathnameValue.charAt(index + segment.length);
      return !after || after === "/";
    }
    function findEarliestSegmentIndex2(pathnameValue, segment) {
      var fromIndex = 0;
      while (fromIndex < pathnameValue.length) {
        var idx = pathnameValue.indexOf(segment, fromIndex);
        if (idx === -1) return -1;
        if (isSegmentMatch2(pathnameValue, segment, idx)) return idx;
        fromIndex = idx + 1;
      }
      return -1;
    }

    for (var n = 0; n < locales.length; n++) {
      var localePattern2 = "/" + locales[n];
      var localeIdx2 = findEarliestSegmentIndex2(pathname, localePattern2);
      if (localeIdx2 > 0) {
        return cleanBasePath(pathname.substring(0, localeIdx2)).replace(/\\/+$/, "");
      }
    }

    var knownPaths2 = ["/api/", "/v1/", "/_next/"];
    for (var p = 0; p < knownPaths2.length; p++) {
      var idx3 = pathname.indexOf(knownPaths2[p]);
      if (idx3 > 0) {
        return cleanBasePath(pathname.substring(0, idx3)).replace(/\\/+$/, "");
      }
    }

    var proxyMatch2 = pathname.match(/^(.*?\\/proxy\\/\\d+)(?:\\/|$)/);
    if (proxyMatch2 && proxyMatch2[1]) {
      return cleanBasePath(proxyMatch2[1]).replace(/\\/+$/, "");
    }

    return "";
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
    for (var m = 0; m < knownPaths.length; m++) {
      var idx2 = currentPath.indexOf(knownPaths[m]);
      if (idx2 > 0) {
        basePath = currentPath.substring(0, idx2);
        break;
      }
    }
  }

  var proxyMatch = currentPath.match(/^(.*?\\/proxy\\/\\d+)(?:\\/|$)/);
  if (!basePath && proxyMatch) {
    basePath = proxyMatch[1];
  }

  if (!basePath && currentPath.length > 1) {
    var pathWithoutTrailingSlash = currentPath.replace(/\\/+$/, "");
    if (pathWithoutTrailingSlash &&
        !pathWithoutTrailingSlash.match(/^\\/(zh-CN|zh-TW|en|ja|ru|api|v1|_next)(\\/|$)/)) {
      basePath = pathWithoutTrailingSlash;
    }
  }

  basePath = cleanBasePath(basePath).replace(/\\/+$/, "");
  var targetBasePath = detectBasePathFromPath(targetPath);
  var targetPathname = getPathname(targetPath);
  var fullPath = "";

  if (!basePath) {
    fullPath = targetPath;
  } else if (!targetBasePath) {
    fullPath = basePath + targetPath;
  } else if (startsWithSegment(targetPathname, basePath)) {
    fullPath = targetPath;
  } else {
    var baseScore = countSegments(basePath);
    var targetScore = countSegments(targetBasePath);

    if (targetScore > baseScore) {
      fullPath = targetPath;
    } else if (targetScore < baseScore) {
      var suffixPath = targetPathname.substring(targetBasePath.length) || "/";
      var searchPart = targetPath.substring(targetPathname.length);
      fullPath = basePath + suffixPath + searchPart;
    } else {
      fullPath = targetPath;
    }
  }

${clearAuthCookieScript}
  fullPath = normalizeRedirectPath(fullPath);
  window.location.replace(fullPath);
})();
</script>
<noscript>
<meta http-equiv="refresh" content="0;url=${noScriptTarget}">
</noscript>
</head>
<body>Redirecting...</body>
</html>`;
}

function createRelativeRedirect(targetPath: string, searchParams?: URLSearchParams): Response {
  let fullTargetPath = targetPath;
  if (searchParams?.toString()) {
    fullTargetPath += `?${searchParams.toString()}`;
  }

  const html = buildRelativeRedirectHtml(fullTargetPath, { noScriptTarget: fullTargetPath });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function startsWithSegment(pathValue: string, prefix: string): boolean {
  return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
}

function resolveTargetPathAgainstCurrentBase(targetPath: string, currentPathname: string): string {
  const normalizedTargetPath = normalizeRedirectPath(targetPath);
  const currentBasePath = detectBasePathFromPath(currentPathname).replace(/\/+$/, "");

  if (!currentBasePath) {
    return normalizedTargetPath;
  }

  const targetQueryIndex = normalizedTargetPath.indexOf("?");
  const targetPathname =
    (targetQueryIndex === -1
      ? normalizedTargetPath
      : normalizedTargetPath.slice(0, targetQueryIndex)) || "/";
  const targetSearch = targetQueryIndex === -1 ? "" : normalizedTargetPath.slice(targetQueryIndex);
  const targetBasePath = detectBasePathFromPath(targetPathname).replace(/\/+$/, "");

  if (!targetBasePath) {
    return normalizeRedirectPath(`${currentBasePath}${targetPathname}${targetSearch}`);
  }

  if (startsWithSegment(targetPathname, currentBasePath)) {
    return normalizedTargetPath;
  }

  const currentBaseSegments = countPathSegments(currentBasePath);
  const targetBaseSegments = countPathSegments(targetBasePath);

  if (targetBaseSegments > currentBaseSegments) {
    return normalizedTargetPath;
  }

  if (targetBaseSegments < currentBaseSegments) {
    const suffixPath = targetPathname.slice(targetBasePath.length) || "/";
    return normalizeRedirectPath(`${currentBasePath}${suffixPath}${targetSearch}`);
  }

  return normalizedTargetPath;
}

function convertToRelativeRedirect(
  response: Response,
  currentPathWithSearch?: string,
  currentPathname?: string
): Response {
  const location = response.headers.get("Location");
  if (!location) {
    return response;
  }

  if (response.status < 300 || response.status >= 400) {
    return response;
  }

  try {
    const url = new URL(location, "http://dummy");
    const targetPath = normalizeRedirectPath(url.pathname + url.search);
    const resolvedTargetPath = currentPathname
      ? resolveTargetPathAgainstCurrentBase(targetPath, currentPathname)
      : targetPath;

    if (currentPathWithSearch) {
      const normalizedCurrentPath = normalizeRedirectPath(currentPathWithSearch);
      if (targetPath === normalizedCurrentPath) {
        const passthroughResponse = NextResponse.next();
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) {
          passthroughResponse.headers.set("set-cookie", setCookie);
        }
        passthroughResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
        return passthroughResponse;
      }
    }

    const html = buildRelativeRedirectHtml(resolvedTargetPath);

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch {
    return response;
  }
}

function proxyHandler(request: NextRequest): Response {
  const method = request.method;
  const pathname = request.nextUrl.pathname;
  const currentPathWithSearch = getOriginalPathWithSearch(request);

  if (isDevelopment()) {
    logger.info("Request received", { method: method.toUpperCase(), pathname });
  }

  // Hard guard: polluted leading /proxy/<port>/ws-... should always be normalized
  // in-process before any canonicalization/redirect decisions.
  if (/^\/proxy\/\d+\/ws-[^/]+(?:\/|$)/.test(pathname)) {
    const collapsedPath = collapseDuplicatedLeadingProxyPrefix(pathname);
    if (collapsedPath !== pathname && hasWorkspaceSegment(collapsedPath)) {
      const normalizedRequest = cloneRequestWithPathname(request, collapsedPath);
      return proxyHandler(normalizedRequest);
    }
  }

  const workspaceAppPath = extractWorkspaceAppPath(pathname);
  if (workspaceAppPath && workspaceAppPath !== pathname) {
    const hasLocaleInWorkspaceAppPath = SUPPORTED_LOCALES.some(
      (locale) => workspaceAppPath === `/${locale}` || workspaceAppPath.startsWith(`/${locale}/`)
    );
    const { pathWithoutLocale: workspacePathWithoutLocale } =
      extractLocaleContext(workspaceAppPath);
    const isPublicWorkspacePath = PUBLIC_PATH_PATTERNS.some(
      (pattern) =>
        workspacePathWithoutLocale === pattern || workspacePathWithoutLocale.startsWith(pattern)
    );
    const hasAuthCookie = Boolean(request.cookies.get(AUTH_COOKIE_NAME));
    const workspaceBasePath = detectBasePathFromPath(pathname);

    if ((hasAuthCookie || isPublicWorkspacePath) && hasLocaleInWorkspaceAppPath) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = workspaceAppPath;
      const requestHeaders = new Headers(request.headers);
      if (workspaceBasePath) {
        requestHeaders.set(WORKSPACE_BASE_PATH_HEADER, workspaceBasePath);
      }

      const response = NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      });
      response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      return response;
    }

    if (!hasAuthCookie && !isPublicWorkspacePath && !hasLocaleInWorkspaceAppPath) {
      const loginPath = workspaceBasePath
        ? `${workspaceBasePath}/${routing.defaultLocale}/login`
        : `/${routing.defaultLocale}/login`;
      const searchParams = new URLSearchParams();
      searchParams.set("from", workspacePathWithoutLocale || "/dashboard");
      return createRelativeRedirect(loginPath, searchParams);
    }

    const normalizedRequest = cloneRequestWithPathname(request, workspaceAppPath, {
      skipRefererRecovery: true,
    });
    return proxyHandler(normalizedRequest);
  }

  const canonicalizedWithEnv = maybeCanonicalizePathWithEnvProxyBase(request);
  if (canonicalizedWithEnv) {
    return canonicalizedWithEnv;
  }

  const nextInternalPath = extractNextInternalPath(pathname);
  if (nextInternalPath && nextInternalPath !== pathname) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = nextInternalPath;
    const response = NextResponse.rewrite(rewriteUrl);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  }

  const normalizedPath = normalizeDuplicatedProxyPrefixPath(pathname);
  if (normalizedPath) {
    // Use in-process normalization instead of external 307 redirect.
    // Some notebook gateways rewrite Location to /proxy/<port>/..., which would
    // re-introduce the polluted prefix and create redirect loops.
    const normalizedRequest = cloneRequestWithPathname(request, normalizedPath);
    return proxyHandler(normalizedRequest);
  }

  const restoredPath = maybeRestoreProxyPrefixFromReferer(request);
  if (restoredPath) {
    const normalizedRequest = cloneRequestWithPathname(request, restoredPath, {
      skipRefererRecovery: true,
    });
    return proxyHandler(normalizedRequest);
  }

  // API 代理路由不需要 locale 处理和 Web 鉴权（使用自己的 Bearer token）
  if (pathname.startsWith(API_PROXY_PATH)) {
    return NextResponse.next();
  }

  // Skip locale/auth handling for Next.js internals and static assets,
  // including prefixed paths like /ws-.../proxy/3000/_next/static/...
  if (
    isNextInternalPath(pathname) ||
    pathname === "/favicon.ico" ||
    pathname.endsWith("/favicon.ico")
  ) {
    return NextResponse.next();
  }

  // Apply locale middleware first (handles locale detection and routing)
  const localeResponse = intlMiddleware(request);

  const { locale, pathWithoutLocale } = extractLocaleContext(pathname);

  // Check if current path (without locale) is a public path
  const isPublicPath = PUBLIC_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(pattern)
  );

  // Public paths don't require authentication
  if (isPublicPath) {
    return convertToRelativeRedirect(localeResponse, currentPathWithSearch, pathname);
  }

  // Check authentication for protected routes (cookie existence only).
  // Full session validation (Redis lookup, key permissions, expiry) is handled
  // by downstream layouts (dashboard/layout.tsx, etc.) which run in Node.js
  // runtime with guaranteed Redis/DB access. This avoids a death loop where
  // the proxy deletes the cookie on transient validation failures.
  const authToken = request.cookies.get(AUTH_COOKIE_NAME);

  if (!authToken) {
    // Not authenticated, redirect to login page
    const loginPath = resolveTargetPathAgainstCurrentBase(`/${locale}/login`, pathname);
    const searchParams = new URLSearchParams();
    searchParams.set("from", pathWithoutLocale || "/dashboard");
    return createRelativeRedirect(loginPath, searchParams);
  }

  // Cookie exists - pass through to layout for full validation
  return convertToRelativeRedirect(localeResponse, currentPathWithSearch, pathname);
}

// Default export required for Next.js 16 proxy file
export default proxyHandler;

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes - handled separately)
     * - favicon.ico (favicon file)
     *
     * NOTE:
     * We intentionally include _next/static and _next/image so the middleware
     * can recover missing workspace proxy prefixes from Referer when the browser
     * requests root-level assets (/_next/...) behind notebook reverse proxies.
     */
    "/((?!api|favicon.ico).*)",
  ],
};
