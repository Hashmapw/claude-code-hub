"use client";

import { Loader2 } from "lucide-react";
import { useEffect } from "react";

interface ClientRedirectProps {
  /**
   * Target path to redirect to (e.g., "/login", "/dashboard")
   * Should be a relative path without locale prefix
   */
  to: string;
  /**
   * Current locale for constructing the full path
   */
  locale: string;
}

/**
 * Client-side redirect component that respects dynamic proxy paths.
 *
 * This component is necessary when the application runs behind a reverse proxy
 * with a dynamic base path (e.g., containing UUIDs). Server-side redirects
 * cannot know the full proxy path, but client-side JavaScript can use
 * window.location to construct the correct URL.
 *
 * Usage:
 * ```tsx
 * // Instead of: return redirect({ href: "/login", locale });
 * // Use: return <ClientRedirect to="/login" locale={locale} />;
 * ```
 */
export function ClientRedirect({ to, locale }: ClientRedirectProps) {
  useEffect(() => {
    // Get the current pathname from the browser
    const currentPath = window.location.pathname;

    // Find the locale segment in the current path to determine the base path
    // The locale should appear as a path segment like /zh-CN/, /en/, etc.
    const localePattern = new RegExp(`^(.*?)/${locale}(?:/|$)`);
    const match = currentPath.match(localePattern);

    let basePath = "";
    if (match) {
      // Extract everything before the locale as the base path
      basePath = match[1] || "";
    }

    // Construct the full redirect URL
    // Ensure the target path starts with /
    const normalizedTo = to.startsWith("/") ? to : `/${to}`;
    const fullPath = `${basePath}/${locale}${normalizedTo}`;

    // Perform the redirect
    window.location.href = fullPath;
  }, [to, locale]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
