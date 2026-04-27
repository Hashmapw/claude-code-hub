import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";
import { findUserById } from "@/repository/user";
import { UserInsightsView } from "./_components/user-insights-view";

export const dynamic = "force-dynamic";

export default async function UserInsightsPage({
  params,
}: {
  params: Promise<{ locale: string; userId: string }>;
}) {
  const { locale, userId: userIdStr } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirectWithWorkspaceBase("/dashboard/leaderboard", locale);
  }

  const userId = Number(userIdStr);
  if (!Number.isInteger(userId) || userId <= 0) {
    return redirectWithWorkspaceBase("/dashboard/leaderboard", locale);
  }

  const user = await findUserById(userId);
  if (!user) {
    return redirectWithWorkspaceBase("/dashboard/leaderboard", locale);
  }

  return <UserInsightsView userId={userId} userName={user.name} />;
}
