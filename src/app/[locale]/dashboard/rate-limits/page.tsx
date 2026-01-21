import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ClientRedirect } from "@/components/client-redirect";
import { Section } from "@/components/section";
import { getSession } from "@/lib/auth";
import { RateLimitDashboard } from "./_components/rate-limit-dashboard";
import { RateLimitsContentSkeleton } from "./_components/rate-limits-skeleton";

export const dynamic = "force-dynamic";

export default async function RateLimitsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return <ClientRedirect to="/dashboard" locale={locale} />;
  }

  const t = await getTranslations("dashboard.rateLimits");

  return (
    <div className="space-y-6">
      <Section title={t("title")} description={t("description")}>
        <Suspense fallback={<RateLimitsContentSkeleton />}>
          <RateLimitDashboard />
        </Suspense>
      </Section>
    </div>
  );
}
