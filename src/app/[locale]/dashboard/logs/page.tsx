import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";
import { getSystemSettings } from "@/repository/system-config";
import { ActiveSessionsSkeleton } from "./_components/active-sessions-skeleton";
import {
  UsageLogsActiveSessionsSection,
  UsageLogsDataSection,
} from "./_components/usage-logs-sections";
import { UsageLogsSkeleton } from "./_components/usage-logs-skeleton";

export const dynamic = "force-dynamic";

export default async function UsageLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;

  const session = await getSession();
  if (!session) {
    return redirectWithWorkspaceBase("/login", locale);
  }

  const isAdmin = session.user.role === "admin";
  const systemSettings = await getSystemSettings();

  return (
    <div className="space-y-4">
      {/* Active Sessions - Horizontal scrolling cards */}
      <Suspense fallback={<ActiveSessionsSkeleton />}>
        <UsageLogsActiveSessionsSection currencyCode={systemSettings.currencyDisplay} />
      </Suspense>

      {/* Stats + Filters + Logs Table */}
      <Suspense fallback={<UsageLogsSkeleton />}>
        <UsageLogsDataSection
          isAdmin={isAdmin}
          userId={session.user.id}
          searchParams={searchParams}
        />
      </Suspense>
    </div>
  );
}
