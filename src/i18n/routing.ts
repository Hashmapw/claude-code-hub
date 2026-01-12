/**
 * i18n Routing Configuration
 * Configures locale routing and provides type-safe navigation utilities
 *
 * Note: When running behind a reverse proxy with a dynamic base path,
 * the navigation interceptor in @/lib/utils/navigation-interceptor.ts
 * handles prepending the base path to all navigation URLs.
 */

import { createNavigation } from "next-intl/navigation";
import { type Routing, routing } from "./routing-config";

// Type-safe navigation utilities
// These replace Next.js's default Link, redirect, useRouter, usePathname
// with locale-aware versions that automatically prepend the locale prefix
export const { Link, redirect, useRouter, usePathname } = createNavigation(routing);

// Re-export routing config and type
export { routing, type Routing };
