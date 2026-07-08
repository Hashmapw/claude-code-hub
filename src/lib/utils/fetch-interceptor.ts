import { getBasePath } from "./base-path";
import { isSiiProxySupportEnabled } from "./sii-proxy-support";

let isPatched = false;

function needsBasePath(url: string, basePath: string): boolean {
  if (!basePath) return false;
  if (!url.startsWith("/")) return false;
  if (url.startsWith(`${basePath}/`) || url === basePath) return false;
  if (url.includes("/proxy/")) return false;
  if (url.startsWith("/_next/")) return false;
  return true;
}

export function patchFetchForProxy(): void {
  if (typeof window === "undefined" || isPatched || !isSiiProxySupportEnabled()) {
    return;
  }

  const originalFetch = window.fetch;

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const currentBasePath = getBasePath();

    if (typeof input === "string") {
      if (needsBasePath(input, currentBasePath)) {
        input = `${currentBasePath}${input}`;
      }
    } else if (input instanceof URL) {
      if (
        input.origin === window.location.origin &&
        needsBasePath(input.pathname, currentBasePath)
      ) {
        const newUrl = new URL(input.toString());
        newUrl.pathname = `${currentBasePath}${newUrl.pathname}`;
        input = newUrl;
      }
    } else if (input instanceof Request) {
      const url = new URL(input.url);
      if (url.origin === window.location.origin && needsBasePath(url.pathname, currentBasePath)) {
        url.pathname = `${currentBasePath}${url.pathname}`;
        input = new Request(url.toString(), input);
      }
    }

    return originalFetch.call(window, input, init);
  };

  isPatched = true;
}

export function isFetchPatched(): boolean {
  return isPatched;
}
