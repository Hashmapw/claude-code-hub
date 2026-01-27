/**
 * Utility functions for handling dynamic reverse proxy base paths.
 *
 * When the application runs behind a reverse proxy with a dynamic path prefix
 * (e.g., /ws-xxx/.../proxy/3000/), we need to dynamically detect and prepend
 * this prefix to all client-side URLs (API calls, navigation, etc.).
 *
 * The base path is detected by finding the locale segment in the current URL
 * and extracting everything before it.
 *
 * Example:
 * - Current URL: https://example.com/ws-xxx/proxy/3000/zh-CN/dashboard
 * - Base path: /ws-xxx/proxy/3000
 * - Locale: zh-CN
 * - Page path: /dashboard
 */

const SUPPORTED_LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ru"];

// Known application routes that should NOT be part of the base path
// These patterns indicate we've entered the app's routing space
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
];

let cachedBasePath: string | null = null;

/**
 * Clean the base path by removing any application routes that may have been
 * incorrectly included (e.g., due to URL pollution from navigation loops).
 *
 * @param basePath - The potentially polluted base path
 * @returns The cleaned base path containing only the proxy prefix
 */
function cleanBasePath(basePath: string): string {
  if (!basePath) return "";

  // Find the first occurrence of any app route in the base path
  let earliestAppRouteIdx = -1;
  for (const route of APP_ROUTES) {
    const idx = basePath.indexOf(route);
    if (idx !== -1 && (earliestAppRouteIdx === -1 || idx < earliestAppRouteIdx)) {
      earliestAppRouteIdx = idx;
    }
  }

  // Also check for locale patterns that shouldn't be in base path
  for (const locale of SUPPORTED_LOCALES) {
    const localePattern = `/${locale}`;
    const idx = basePath.indexOf(localePattern);
    if (idx !== -1 && (earliestAppRouteIdx === -1 || idx < earliestAppRouteIdx)) {
      // Verify it's a locale segment (followed by / or end)
      const afterLocale = basePath.substring(idx + localePattern.length);
      if (afterLocale === "" || afterLocale.startsWith("/")) {
        earliestAppRouteIdx = idx;
      }
    }
  }

  // If we found an app route or locale in the base path, truncate before it
  if (earliestAppRouteIdx >= 0) {
    return basePath.substring(0, earliestAppRouteIdx);
  }

  return basePath;
}

/**
 * Get the base path prefix from the current URL.
 * This extracts the proxy path prefix before the locale segment.
 *
 * @returns The base path (e.g., "/ws-xxx/proxy/3000") or empty string if none
 */
export function getBasePath(): string {
  if (typeof window === "undefined") {
    return "";
  }

  if (cachedBasePath !== null) {
    return cachedBasePath;
  }

  const currentPath = window.location.pathname;

  const proxyMatch = currentPath.match(/^(.*?\/proxy\/\d+)(?:\/|$)/);
  if (proxyMatch) {
    const proxyPrefix = proxyMatch[1];
    const cleaned = cleanBasePath(proxyPrefix);
    if (cleaned) {
      cachedBasePath = cleaned;
      return cachedBasePath;
    }
  }

  // Find the locale segment in the path
  for (const locale of SUPPORTED_LOCALES) {
    const localePattern = `/${locale}`;
    const idx = currentPath.indexOf(localePattern);

    if (idx !== -1) {
      // Check if it's actually a locale segment (followed by / or end of string)
      const afterLocale = currentPath.substring(idx + localePattern.length);
      if (afterLocale === "" || afterLocale.startsWith("/")) {
        // Return everything before the locale segment, cleaned of any app routes
        const rawBasePath = currentPath.substring(0, idx);
        return cleanBasePath(rawBasePath);
      }
    }
  }

  // No locale found, check if path starts with /api or other known paths
  // In this case, try to find the base path by looking for known app paths
  const knownPaths = ["/api/", "/v1/", "/_next/"];
  for (const knownPath of knownPaths) {
    const idx = currentPath.indexOf(knownPath);
    if (idx > 0) {
      const rawBasePath = currentPath.substring(0, idx);
      return cleanBasePath(rawBasePath);
    }
  }

  // If still no base path found and current path has content,
  // check if the entire path (minus trailing /) could be the base path
  // This handles the case of accessing proxy root like /ws-xxx/.../proxy/3000/
  if (currentPath.length > 1) {
    // Remove trailing slash if present
    const pathWithoutTrailingSlash = currentPath.replace(/\/+$/, "");
    // If the path doesn't start with a known app route, treat it as base path
    if (
      pathWithoutTrailingSlash &&
      !pathWithoutTrailingSlash.match(/^\/(zh-CN|zh-TW|en|ja|ru|api|v1|_next)(\/|$)/)
    ) {
      return cleanBasePath(pathWithoutTrailingSlash);
    }
  }

  return "";
}

/**
 * Get the full API base path.
 *
 * @returns The API base path (e.g., "/ws-xxx/proxy/3000/api" or "/api")
 */
export function getApiBasePath(): string {
  const basePath = getBasePath();
  return basePath ? `${basePath}/api` : "/api";
}

/**
 * Build a full URL with the base path prefix.
 *
 * @param path - The path to prefix (should start with /)
 * @returns The full path with base path prefix
 */
export function withBasePath(path: string): string {
  const basePath = getBasePath();
  if (!basePath) {
    return path;
  }

  // Avoid double slashes
  if (path.startsWith("/")) {
    return `${basePath}${path}`;
  }
  return `${basePath}/${path}`;
}

/**
 * Build an API URL with the base path prefix.
 *
 * @param endpoint - The API endpoint (e.g., "/auth/login" or "auth/login")
 * @returns The full API URL (e.g., "/ws-xxx/proxy/3000/api/auth/login")
 */
export function apiUrl(endpoint: string): string {
  const apiBase = getApiBasePath();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${apiBase}${cleanEndpoint}`;
}

/**
 * Fetch wrapper that automatically prepends the base path to API calls.
 *
 * @param endpoint - The API endpoint (e.g., "/auth/login")
 * @param options - Fetch options
 * @returns Fetch response
 */
export async function apiFetch(endpoint: string, options?: RequestInit): Promise<Response> {
  const url = apiUrl(endpoint);
  return fetch(url, options);
}
