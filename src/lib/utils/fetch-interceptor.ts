/**
 * Global fetch interceptor for reverse proxy base path support.
 *
 * This module patches the global fetch function to automatically prepend
 * the base path to internal requests when running behind a reverse proxy.
 *
 * Usage: Import this module once in your app's entry point (e.g., layout.tsx)
 *
 * How it works:
 * - Intercepts all fetch calls
 * - For internal requests (starting with "/"), prepends the detected base path
 * - Leaves external URLs and already-prefixed paths unchanged
 */

import { getBasePath } from "./base-path";

let isPatched = false;
let cachedBasePath: string | null = null;

/**
 * Check if a URL needs base path prepending
 */
function needsBasePath(url: string, basePath: string): boolean {
  // Must start with / (absolute path)
  if (!url.startsWith("/")) {
    return false;
  }

  // Already has base path
  if (url.startsWith(`${basePath}/`)) {
    return false;
  }

  // Don't modify _next paths - these are handled by assetPrefix
  if (url.startsWith("/_next/")) {
    return false;
  }

  return true;
}

/**
 * Patch the global fetch to support reverse proxy base paths.
 * This function is idempotent - calling it multiple times has no effect.
 */
export function patchFetchForProxy(): void {
  if (typeof window === "undefined" || isPatched) {
    return;
  }

  // Cache the base path at initialization time
  cachedBasePath = getBasePath();

  // Only patch if we have a base path
  if (!cachedBasePath) {
    isPatched = true;
    return;
  }

  const basePath = cachedBasePath;
  const originalFetch = window.fetch;

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // Handle string URLs
    if (typeof input === "string") {
      if (needsBasePath(input, basePath)) {
        input = `${basePath}${input}`;
      }
    }
    // Handle URL objects
    else if (input instanceof URL) {
      // Only modify same-origin URLs
      if (input.origin === window.location.origin && needsBasePath(input.pathname, basePath)) {
        const newUrl = new URL(input.toString());
        newUrl.pathname = `${basePath}${newUrl.pathname}`;
        input = newUrl;
      }
    }
    // Handle Request objects
    else if (input instanceof Request) {
      const url = new URL(input.url);
      // Only modify same-origin URLs
      if (url.origin === window.location.origin && needsBasePath(url.pathname, basePath)) {
        url.pathname = `${basePath}${url.pathname}`;
        // Create a new Request with the modified URL
        input = new Request(url.toString(), input);
      }
    }

    return originalFetch.call(window, input, init);
  };

  isPatched = true;
}

/**
 * Check if fetch has been patched.
 */
export function isFetchPatched(): boolean {
  return isPatched;
}
