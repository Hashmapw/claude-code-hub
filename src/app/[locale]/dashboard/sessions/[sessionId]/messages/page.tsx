import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";
import { SessionMessagesClient } from "./_components/session-messages-client";

export const dynamic = "force-dynamic";

export default async function SessionMessagesPage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();

  // Permission check: only admin users can access
  if (!session || session.user.role !== "admin") {
    return <ClientRedirect to={session ? "/dashboard" : "/login"} locale={locale} />;
  }

  return <SessionMessagesClient />;
}
