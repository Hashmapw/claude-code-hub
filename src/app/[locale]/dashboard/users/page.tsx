import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";
import { UsersPageClient } from "./users-page-client";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // 权限检查：允许所有登录用户访问
  if (!session) {
    return redirectWithWorkspaceBase("/login", locale);
  }

  // TypeScript: session is guaranteed to be non-null after the redirect check
  return <UsersPageClient currentUser={session.user} />;
}
