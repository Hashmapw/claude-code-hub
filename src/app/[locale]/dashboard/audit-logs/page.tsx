import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";
import { AuditLogsView } from "./_components/audit-logs-view";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session) {
    return redirectWithWorkspaceBase("/login?from=/dashboard/audit-logs", locale);
  }

  if (session.user.role !== "admin") {
    return redirectWithWorkspaceBase("/dashboard", locale);
  }

  const t = await getTranslations("auditLogs");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
      </div>
      <AuditLogsView />
    </div>
  );
}
