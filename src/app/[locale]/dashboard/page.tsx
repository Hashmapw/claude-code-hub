import { Suspense } from "react";
import { hasPriceTable } from "@/actions/model-prices";
import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";
import {
  DashboardLeaderboardSection,
  DashboardOverviewSection,
  DashboardStatisticsSection,
} from "./_components/dashboard-sections";
import {
  DashboardLeaderboardSkeleton,
  DashboardOverviewSkeleton,
  DashboardStatisticsSkeleton,
} from "./_components/dashboard-skeletons";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  const hasPrices = await hasPriceTable();
  if (!hasPrices) {
    return <ClientRedirect to="/settings/prices?required=true" locale={locale} />;
  }

  const session = await getSession();
  const isAdmin = session?.user?.role === "admin";

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Suspense fallback={<DashboardOverviewSkeleton />}>
          <DashboardOverviewSection isAdmin={isAdmin} />
        </Suspense>
      ) : null}

      <Suspense fallback={<DashboardStatisticsSkeleton />}>
        <DashboardStatisticsSection />
      </Suspense>

      <Suspense fallback={<DashboardLeaderboardSkeleton />}>
        <DashboardLeaderboardSection isAdmin={isAdmin} />
      </Suspense>
    </div>
  );
}
