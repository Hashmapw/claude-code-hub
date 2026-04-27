import { Suspense } from "react";
import { hasPriceTable } from "@/actions/model-prices";
import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";
import { DashboardBentoSection } from "./_components/dashboard-bento-sections";
import { DashboardOverviewSkeleton } from "./_components/dashboard-skeletons";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  const hasPrices = await hasPriceTable();
  if (!hasPrices) {
    return redirectWithWorkspaceBase("/settings/prices?required=true", locale);
  }

  const session = await getSession();
  const isAdmin = session?.user?.role === "admin";

  return (
    <Suspense fallback={<DashboardOverviewSkeleton />}>
      <DashboardBentoSection isAdmin={isAdmin} />
    </Suspense>
  );
}
