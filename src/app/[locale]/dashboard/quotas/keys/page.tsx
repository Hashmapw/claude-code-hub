// This page has been deprecated. Key-level quotas are now managed at user level.
// Users should visit /dashboard/quotas/users instead.
// Redirecting to user quotas page...

import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";

export default async function KeysQuotaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // 权限检查：仅 admin 用户可访问
  if (!session || session.user.role !== "admin") {
    return redirectWithWorkspaceBase(session ? "/dashboard/my-quota" : "/login", locale);
  }

  return redirectWithWorkspaceBase("/dashboard/quotas/users", locale);
}
