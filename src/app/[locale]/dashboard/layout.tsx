import type { ReactNode } from "react";
import { ClientRedirect } from "@/components/client-redirect";

import { getSession } from "@/lib/auth";
import { DashboardHeader } from "./_components/dashboard-header";
import { DashboardMain } from "./_components/dashboard-main";
import { WebhookMigrationDialog } from "./_components/webhook-migration-dialog";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const session = await getSession();

  if (!session) {
    return <ClientRedirect to="/login?from=/dashboard" locale={locale} />;
  }

  if (session.user.role !== "admin" && !session.key.canLoginWebUi) {
    return <ClientRedirect to="/my-usage" locale={locale} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader session={session} />
      <DashboardMain>{children}</DashboardMain>
      <WebhookMigrationDialog />
    </div>
  );
}
