"use client";

import { useEffect } from "react";
import { patchFetchForProxy } from "@/lib/utils/fetch-interceptor";
import { patchNavigationForProxy } from "@/lib/utils/navigation-interceptor";

export function ProxyFetchInitializer(): null {
  useEffect(() => {
    patchFetchForProxy();
    patchNavigationForProxy();
  }, []);

  return null;
}
