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

  const currentPath = window.location.pathname;

  // Find the locale segment in the path
  for (const locale of SUPPORTED_LOCALES) {
    const localePattern = `/${locale}`;
    const idx = currentPath.indexOf(localePattern);

    if (idx !== -1) {
      // Check if it's actually a locale segment (followed by / or end of string)
      const afterLocale = currentPath.substring(idx + localePattern.length);
      if (afterLocale === "" || afterLocale.startsWith("/")) {
        // Return everything before the locale segment
        return currentPath.substring(0, idx);
      }
    }
  }

  // No locale found, check if path starts with /api or other known paths
  // In this case, try to find the base path by looking for known app paths
  const knownPaths = ["/api/", "/v1/", "/_next/"];
  for (const knownPath of knownPaths) {
    const idx = currentPath.indexOf(knownPath);
    if (idx > 0) {
      return currentPath.substring(0, idx);
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
