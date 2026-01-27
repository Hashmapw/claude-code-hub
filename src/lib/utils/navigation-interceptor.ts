/**
 * Navigation interceptor for reverse proxy base path support.
 *
 * This module intercepts navigation events to handle base path prefixing
 * when running behind a reverse proxy with a dynamic path prefix.
 *
 * Strategy:
 * - Intercept click events on links and redirect with correct base path
 * - Patch history.pushState/replaceState for programmatic navigation
 * - Do NOT modify href attributes (this interferes with Next.js/next-intl)
 *
 * This ensures all navigation methods work correctly with the proxy base path.
 */

import { getBasePath } from "./base-path";

let isPatched = false;

/**
 * Check if a URL should have base path prepended
 */
function shouldPrependBasePath(href: string, basePath: string): boolean {
  if (!href) return false;

  // Don't modify external protocols
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("javascript:") ||
    href.startsWith("#") ||
    href.startsWith("blob:") ||
    href.startsWith("data:")
  ) {
    return false;
  }

  // Must be an absolute path
  if (!href.startsWith("/")) {
    return false;
  }

  // Already has base path
  if (href.startsWith(`${basePath}/`) || href === basePath) {
    return false;
  }

  if (href.includes("/proxy/")) {
    return false;
  }

  // Don't modify _next paths (handled by assetPrefix)
  if (href.startsWith("/_next/")) {
    return false;
  }

  return true;
}

/**
 * Prepend base path to a URL
 */
function prependBasePath(href: string, basePath: string): string {
  return `${basePath}${href}`;
}

/**
 * Patch navigation APIs for proxy support.
 * This function is idempotent - calling it multiple times has no effect.
 */
export function patchNavigationForProxy(): void {
  if (typeof window === "undefined" || isPatched) {
    return;
  }

  const basePath = getBasePath();

  // Only patch if we have a base path (running behind proxy)
  if (!basePath) {
    isPatched = true;
    return;
  }

  // Intercept click events on links
  // Use capture phase to intercept before Next.js handles the click
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest("a");

      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Check if we need to add base path
      if (!shouldPrependBasePath(href, basePath)) return;

      // Skip if it has target="_blank" or similar
      const anchorTarget = anchor.getAttribute("target");
      if (anchorTarget && anchorTarget !== "_self") return;

      // Skip if modifier keys are pressed (user wants to open in new tab)
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      // Skip download links
      if (anchor.hasAttribute("download")) return;

      // Prevent Next.js from handling this navigation
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Navigate with the correct base path
      const newHref = prependBasePath(href, basePath);
      window.location.href = newHref;
    },
    true // Capture phase
  );

  // Patch history.pushState and history.replaceState
  // This handles programmatic navigation via router.push()
  const originalPushState = history.pushState.bind(history);
  history.pushState = (data: unknown, unused: string, url?: string | URL | null): void => {
    if (url) {
      const urlStr = url.toString();
      if (shouldPrependBasePath(urlStr, basePath)) {
        url = prependBasePath(urlStr, basePath);
      }
    }
    originalPushState(data, unused, url);
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
    if (url) {
      const urlStr = url.toString();
      if (shouldPrependBasePath(urlStr, basePath)) {
        url = prependBasePath(urlStr, basePath);
      }
    }
    originalReplaceState(data, unused, url);
  };

  isPatched = true;
}

/**
 * Check if navigation has been patched.
 */
export function isNavigationPatched(): boolean {
  return isPatched;
}
