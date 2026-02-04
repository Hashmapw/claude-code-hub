"use client";

import { createNavigation } from "next-intl/navigation";
import type { ComponentProps } from "react";
import { forwardRef } from "react";
import { getBasePath } from "@/lib/utils/base-path";
import { routing } from "./routing-config";

const navigation = createNavigation(routing);
const NextIntlLink = navigation.Link;

type LinkProps = ComponentProps<typeof NextIntlLink>;

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

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, onClick, ...props },
  ref
) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const basePath = getBasePath();

    if (basePath) {
      e.preventDefault();

      const hrefStr = typeof href === "string" ? href : href.pathname || "/";
      const locale = getCurrentLocaleFromPath();

      const fullPath = hasLocalePrefix(hrefStr)
        ? `${basePath}${hrefStr}`
        : `${basePath}/${locale}${hrefStr}`;

      window.location.href = fullPath;
      return;
    }

    onClick?.(e);
  };

  return <NextIntlLink ref={ref} href={href} onClick={handleClick} {...props} />;
});
