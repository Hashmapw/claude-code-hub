import { normalizePathnameForLocaleNavigation } from "@/i18n/pathname";

const DEFAULT_REDIRECT_PATH = "/dashboard";
const PROTOCOL_LIKE_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

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

function normalizeDuplicatedProxyPrefix(candidate: string): string {
  const [pathname, ...searchParts] = candidate.split("?");
  const search = searchParts.length > 0 ? `?${searchParts.join("?")}` : "";
  const normalizedPath = collapseDuplicatedLeadingProxyPrefix(pathname);
  return `${normalizedPath}${search}`;
}

export function sanitizeRedirectPath(from: string): string {
  const candidate = from.trim();

  if (!candidate) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (!candidate.startsWith("/")) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (candidate.startsWith("//")) {
    return DEFAULT_REDIRECT_PATH;
  }

  if (PROTOCOL_LIKE_PATTERN.test(candidate)) {
    return DEFAULT_REDIRECT_PATH;
  }

  const withoutLeadingSlash = candidate.slice(1);
  if (PROTOCOL_LIKE_PATTERN.test(withoutLeadingSlash)) {
    return DEFAULT_REDIRECT_PATH;
  }

  return normalizePathnameForLocaleNavigation(
    normalizeDuplicatedProxyPrefix(candidate),
    DEFAULT_REDIRECT_PATH
  );
}

export function resolveLoginRedirectTarget(redirectTo: unknown, from: string): string {
  if (typeof redirectTo === "string" && redirectTo.trim().length > 0) {
    return sanitizeRedirectPath(redirectTo);
  }

  return sanitizeRedirectPath(from);
}
