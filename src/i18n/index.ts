/**
 * i18n Module Exports
 * Central export point for all i18n utilities
 */

// Configuration
export { defaultLocale, type Locale, localeLabels, localeNamesInEnglish, locales } from "./config";
export { Link } from "./link";
// Request configuration (for use in next.config.ts)
export { default as getRequestConfig } from "./request";
export { useRouter } from "./router";
// Routing and navigation
export { type Routing, redirect, routing, usePathname } from "./routing";
