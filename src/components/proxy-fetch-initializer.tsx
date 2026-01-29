"use client";

import { useEffect } from "react";
import { patchFetchForProxy } from "@/lib/utils/fetch-interceptor";
import { patchNavigationForProxy } from "@/lib/utils/navigation-interceptor";

/**
 * Component that initializes interceptors for reverse proxy support.
 * This should be placed in the root layout to ensure it runs on all pages.
 *
 * Initializes:
 * - Fetch interceptor: Prepends base path to /api/ requests
 * - Navigation interceptor: Handles link clicks and history API
 */
export function ProxyFetchInitializer(): null {
  useEffect(() => {
    patchFetchForProxy();
    patchNavigationForProxy();
  }, []);

  return null;
}
