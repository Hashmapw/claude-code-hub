"use client";

import { useEffect } from "react";
import { patchFetchForProxy } from "@/lib/utils/fetch-interceptor";
import { patchNavigationForProxy } from "@/lib/utils/navigation-interceptor";
import { isSiiProxySupportEnabled } from "@/lib/utils/sii-proxy-support";

export function ProxyFetchInitializer(): null {
  useEffect(() => {
    if (!isSiiProxySupportEnabled()) {
      return;
    }
    patchFetchForProxy();
    patchNavigationForProxy();
  }, []);

  return null;
}
