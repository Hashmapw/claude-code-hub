import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
  const requestHeaders = await headers();
  const workspaceBasePath = normalizeBasePath(requestHeaders.get(WORKSPACE_BASE_PATH_HEADER));
  const normalizedHref = href.startsWith("/") ? href : `/${href}`;
  const target = `${workspaceBasePath}/${locale}${normalizedHref}`.replace(/\/{2,}/g, "/");
  redirect(target);
}
