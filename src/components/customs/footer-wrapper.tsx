"use client";

import { usePathname } from "next/navigation";

export function FooterWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const normalizedPathname = pathname.replace(/\/+$/, "");

  if (normalizedPathname.endsWith("/login")) {
    return null;
  }

  return <>{children}</>;
}
