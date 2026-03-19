"use client";

import { Loader2 } from "lucide-react";
import { useEffect } from "react";

interface RootLocaleRedirectProps {
  to: string;
}

export function RootLocaleRedirect({ to }: RootLocaleRedirectProps) {
  useEffect(() => {
    const normalizedTarget = to.replace(/^\/+/, "");
    const currentUrl = new URL(window.location.href);
    const currentPath = currentUrl.pathname.replace(/\/+$/, "");
    const targetUrl = new URL(window.location.href);

    targetUrl.pathname = `${currentPath}/${normalizedTarget}`;

    if (targetUrl.pathname === currentUrl.pathname && targetUrl.search === currentUrl.search) {
      return;
    }

    window.location.replace(targetUrl.toString());
  }, [to]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
