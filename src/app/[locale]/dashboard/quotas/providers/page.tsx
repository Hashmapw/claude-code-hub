import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getProviderLimitUsageBatch, getProviders } from "@/actions/providers";
import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { ProvidersQuotaSkeleton } from "../_components/providers-quota-skeleton";
import { ProvidersQuotaManager } from "./_components/providers-quota-manager";

// Force dynamic rendering (this page needs real-time data and authentication)
export const dynamic = "force-dynamic";

async function getProvidersWithQuotas() {
  const providers = await getProviders();

  // Use batch query to get quota data for all providers (avoid N+1 query problem)
  // Before optimization: 50 providers = 52 DB + 250 Redis queries
  // After optimization: 50 providers = 2 DB + 2 Redis Pipeline queries
  const quotaMap = await getProviderLimitUsageBatch(
    providers.map((p) => ({
      id: p.id,
      dailyResetTime: p.dailyResetTime,
      dailyResetMode: p.dailyResetMode,
      limit5hUsd: p.limit5hUsd,
      limitDailyUsd: p.limitDailyUsd,
      limitWeeklyUsd: p.limitWeeklyUsd,
      limitMonthlyUsd: p.limitMonthlyUsd,
      limitConcurrentSessions: p.limitConcurrentSessions,
    }))
  );

  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    isEnabled: provider.isEnabled,
    priority: provider.priority,
    weight: provider.weight,
    quota: quotaMap.get(provider.id) ?? null,
  }));
}

export default async function ProvidersQuotaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();

  // Permission check: only admin users can access
  if (!session || session.user.role !== "admin") {
    return <ClientRedirect to={session ? "/dashboard/my-quota" : "/login"} locale={locale} />;
  }

  const t = await getTranslations("quota.providers");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
        </div>
      </div>

      <Suspense fallback={<ProvidersQuotaSkeleton />}>
        <ProvidersQuotaContent />
      </Suspense>
    </div>
  );
}

async function ProvidersQuotaContent() {
  const [providers, systemSettings] = await Promise.all([
    getProvidersWithQuotas(),
    getSystemSettings(),
  ]);
  const t = await getTranslations("quota.providers");

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("totalCount", { count: providers.length })}
      </p>
      <ProvidersQuotaManager providers={providers} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
