import { getBasePath } from "./base-path";
import { isSiiProxySupportEnabled } from "./sii-proxy-support";

let isPatched = false;

function shouldPrependBasePath(href: string, basePath: string): boolean {
  if (!basePath) return false;
  if (!href) return false;

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

  if (!href.startsWith("/")) return false;
  if (href.startsWith(`${basePath}/`) || href === basePath) return false;
  if (href.includes("/proxy/")) return false;
  if (href.startsWith("/_next/")) return false;

  return true;
}

function prependBasePath(href: string, basePath: string): string {
  return `${basePath}${href}`;
}

export function patchNavigationForProxy(): void {
  if (typeof window === "undefined" || isPatched || !isSiiProxySupportEnabled()) {
    return;
  }

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest("a");

      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      const currentBasePath = getBasePath();

      if (!shouldPrependBasePath(href, currentBasePath)) return;

      const anchorTarget = anchor.getAttribute("target");
      if (anchorTarget && anchorTarget !== "_self") return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (anchor.hasAttribute("download")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const newHref = prependBasePath(href, currentBasePath);
      window.location.href = newHref;
    },
    true
  );

  const originalPushState = history.pushState.bind(history);
  history.pushState = (data: unknown, unused: string, url?: string | URL | null): void => {
    if (url) {
      const urlStr = url.toString();
      const currentBasePath = getBasePath();
      if (shouldPrependBasePath(urlStr, currentBasePath)) {
        url = prependBasePath(urlStr, currentBasePath);
      }
    }
    originalPushState(data, unused, url);
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
    if (url) {
      const urlStr = url.toString();
      const currentBasePath = getBasePath();
      if (shouldPrependBasePath(urlStr, currentBasePath)) {
        url = prependBasePath(urlStr, currentBasePath);
      }
    }
    originalReplaceState(data, unused, url);
  };

  isPatched = true;
}

export function isNavigationPatched(): boolean {
  return isPatched;
}
