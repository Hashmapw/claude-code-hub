import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isSiiProxySupportEnabled } from "./sii-proxy-support";

export const WORKSPACE_BASE_PATH_HEADER = "x-cch-base-path";

function normalizeBasePath(value: string | null): string {
  if (!value) {
    return "";
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("/")) {
    return "";
  }

  return trimmed;
}

export async function redirectWithWorkspaceBase(href: string, locale: string): Promise<never> {
  const normalizedHref = href.startsWith("/") ? href : `/${href}`;

  if (!isSiiProxySupportEnabled()) {
    redirect(`/${locale}${normalizedHref}`.replace(/\/{2,}/g, "/"));
  }

  const requestHeaders = await headers();
  const workspaceBasePath = normalizeBasePath(requestHeaders.get(WORKSPACE_BASE_PATH_HEADER));
  const target = `${workspaceBasePath}/${locale}${normalizedHref}`.replace(/\/{2,}/g, "/");
  redirect(target);
}
