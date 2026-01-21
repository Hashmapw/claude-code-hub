import { BarChart3 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoSortPriorityDialog } from "@/app/[locale]/settings/providers/_components/auto-sort-priority-dialog";
import { ProviderManagerLoader } from "@/app/[locale]/settings/providers/_components/provider-manager-loader";
import { SchedulingRulesDialog } from "@/app/[locale]/settings/providers/_components/scheduling-rules-dialog";
import { ClientRedirect } from "@/components/client-redirect";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config/env.schema";

export const dynamic = "force-dynamic";

export default async function DashboardProvidersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return <ClientRedirect to={session ? "/dashboard" : "/login"} locale={locale} />;
  }

  const currentUser = session!.user;

  const t = await getTranslations("settings");

  const enableMultiProviderTypes = getEnvConfig().ENABLE_MULTI_PROVIDER_TYPES;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("providers.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("providers.description")}</p>
      </div>

      <Section
        title={t("providers.section.title")}
        description={t("providers.section.description")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/leaderboard?scope=provider">
                <BarChart3 className="h-4 w-4" />
                {t("providers.section.leaderboard")}
              </Link>
            </Button>
            <AutoSortPriorityDialog />
            <SchedulingRulesDialog />
          </>
        }
      >
        <ProviderManagerLoader
          currentUser={currentUser}
          enableMultiProviderTypes={enableMultiProviderTypes}
        />
      </Section>
    </div>
  );
}
