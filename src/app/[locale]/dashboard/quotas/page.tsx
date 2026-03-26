import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";

export default async function QuotasPage({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const session = await getSession();
  if (!session) {
    return redirectWithWorkspaceBase("/login", locale);
  }

  if (session.user.role !== "admin") {
    return redirect({ href: "/dashboard/my-quota", locale });
  }

  return redirect({ href: "/dashboard/quotas/users", locale });
}
