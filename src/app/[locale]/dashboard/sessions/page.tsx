import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";
import { ActiveSessionsClient } from "./_components/active-sessions-client";

export const dynamic = "force-dynamic";

export default async function ActiveSessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return <ClientRedirect to={session ? "/dashboard" : "/login"} locale={locale} />;
  }

  return <ActiveSessionsClient />;
}
