"use client";

import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { getBasePath } from "@/lib/utils/base-path";

interface ClientRedirectProps {
  to: string;
  locale: string;
}

export function ClientRedirect({ to, locale }: ClientRedirectProps) {
  useEffect(() => {
    const basePath = getBasePath();
    const normalizedTo = to.startsWith("/") ? to : `/${to}`;
    const fullPath = `${basePath}/${locale}${normalizedTo}`;

    window.location.href = fullPath;
  }, [to, locale]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
