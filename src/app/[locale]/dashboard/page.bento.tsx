import { Suspense } from "react";
import { hasPriceTable } from "@/actions/model-prices";
import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";
import { DashboardBentoSection } from "./_components/dashboard-bento-sections";
import { DashboardOverviewSkeleton } from "./_components/dashboard-skeletons";

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
    <Suspense fallback={<DashboardOverviewSkeleton />}>
      <DashboardBentoSection isAdmin={isAdmin} />
    </Suspense>
  );
}
