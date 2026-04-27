import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";
import { ActiveSessionsClient } from "./_components/active-sessions-client";

export const dynamic = "force-dynamic";

export default async function ActiveSessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();

  // 权限检查：仅 admin 用户可访问
  if (!session || session.user.role !== "admin") {
    return redirectWithWorkspaceBase(session ? "/dashboard" : "/login", locale);
  }

  return <ActiveSessionsClient />;
}
