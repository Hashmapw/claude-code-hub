/**
 * Navigation interceptor for reverse proxy base path support.
 *
 * This module patches browser navigation APIs and modifies link elements
 * to handle base path prefixing when running behind a reverse proxy.
 *
 * Strategy:
 * 1. Use MutationObserver to modify link href attributes as they're added to DOM
 * 2. Intercept click events as a fallback
 * 3. Patch history.pushState/replaceState for programmatic navigation
 *
 * This ensures all navigation methods work correctly with the proxy base path.
 */

import { getBasePath } from "./base-path";

let isPatched = false;
let observer: MutationObserver | null = null;

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
 * Process a single anchor element, modifying its href if needed
 */
function processAnchor(anchor: HTMLAnchorElement, basePath: string): void {
  const href = anchor.getAttribute("href");
  if (href && shouldPrependBasePath(href, basePath)) {
    const newHref = prependBasePath(href, basePath);
    anchor.setAttribute("href", newHref);
  }
}

/**
 * Process all anchor elements in a node and its descendants
 */
function processNode(node: Node, basePath: string): void {
  if (node instanceof HTMLAnchorElement) {
    processAnchor(node, basePath);
  }

  if (node instanceof HTMLElement) {
    const anchors = node.querySelectorAll("a[href]");
    anchors.forEach((anchor) => {
      processAnchor(anchor as HTMLAnchorElement, basePath);
    });
  }
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

  // Process all existing anchors
  processNode(document.body, basePath);

  // Set up MutationObserver to handle dynamically added links
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Handle added nodes
      for (const node of mutation.addedNodes) {
        processNode(node, basePath);
      }

      // Handle attribute changes on anchor elements
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "href" &&
        mutation.target instanceof HTMLAnchorElement
      ) {
        const anchor = mutation.target;
        const href = anchor.getAttribute("href");
        // Only process if it doesn't already have base path (avoid infinite loop)
        if (href && shouldPrependBasePath(href, basePath)) {
          // Use setTimeout to avoid triggering observer recursively
          setTimeout(() => {
            const currentHref = anchor.getAttribute("href");
            if (currentHref && shouldPrependBasePath(currentHref, basePath)) {
              anchor.setAttribute("href", prependBasePath(currentHref, basePath));
            }
          }, 0);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });

  // Fallback: Intercept click events for any links we might have missed
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest("a");

      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // If the href still needs base path (shouldn't happen, but just in case)
      if (shouldPrependBasePath(href, basePath)) {
        event.preventDefault();
        event.stopPropagation();
        window.location.href = prependBasePath(href, basePath);
      }
    },
    true
  );

  // Patch history.pushState and history.replaceState
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

/**
 * Clean up the navigation interceptor (useful for testing)
 */
export function cleanupNavigationInterceptor(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  isPatched = false;
}
