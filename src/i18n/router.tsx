"use client";

import { createNavigation } from "next-intl/navigation";
import { useCallback, useMemo } from "react";
import { getBasePath } from "@/lib/utils/base-path";
import { routing } from "./routing-config";

const navigation = createNavigation(routing);
const originalUseRouter = navigation.useRouter;

const LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ru"];

function getCurrentLocaleFromPath(): string {
  if (typeof window === "undefined") return "en";
  const pathname = window.location.pathname;
  const basePath = getBasePath();
  const pathWithoutBase = basePath ? pathname.replace(basePath, "") : pathname;

  for (const locale of LOCALES) {
    if (pathWithoutBase.startsWith(`/${locale}/`) || pathWithoutBase === `/${locale}`) {
      return locale;
    }
  }
  return "en";
}

function hasLocalePrefix(href: string): boolean {
  for (const locale of LOCALES) {
    if (href.startsWith(`/${locale}/`) || href === `/${locale}`) {
      return true;
    }
  }
  return false;
}

function buildFullPath(href: string): string {
  const basePath = getBasePath();
  if (!basePath) return href;

  const locale = getCurrentLocaleFromPath();

  if (hasLocalePrefix(href)) {
    return `${basePath}${href}`;
  }

  return `${basePath}/${locale}${href}`;
}

export function useRouter() {
  const router = originalUseRouter();

  const push = useCallback(
    (href: string, options?: { locale?: string; scroll?: boolean }) => {
      const basePath = getBasePath();
      if (basePath) {
        const fullPath = buildFullPath(href);
        window.location.href = fullPath;
        return;
      }
      router.push(href, options);
    },
    [router]
  );

  const replace = useCallback(
    (href: string, options?: { locale?: string; scroll?: boolean }) => {
      const basePath = getBasePath();
      if (basePath) {
        const fullPath = buildFullPath(href);
        window.location.replace(fullPath);
        return;
      }
      router.replace(href, options);
    },
    [router]
  );

  return useMemo(
    () => ({
      ...router,
      push,
      replace,
    }),
    [router, push, replace]
  );
}
