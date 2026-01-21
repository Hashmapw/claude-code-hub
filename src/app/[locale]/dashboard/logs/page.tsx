import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ClientRedirect } from "@/components/client-redirect";
import { Section } from "@/components/section";
import { getSession } from "@/lib/auth";
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
    return <ClientRedirect to="/login" locale={locale} />;
  }

  const isAdmin = session.user.role === "admin";

  const t = await getTranslations("dashboard");

  return (
    <div className="space-y-6">
      <Suspense fallback={<ActiveSessionsSkeleton />}>
        <UsageLogsActiveSessionsSection />
      </Suspense>

      <Section title={t("title.usageLogs")} description={t("title.usageLogsDescription")}>
        <Suspense fallback={<UsageLogsSkeleton />}>
          <UsageLogsDataSection
            isAdmin={isAdmin}
            userId={session.user.id}
            searchParams={searchParams}
          />
        </Suspense>
      </Section>
    </div>
  );
}
