import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";
import { UsersPageClient } from "./users-page-client";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session) {
    return <ClientRedirect to="/login" locale={locale} />;
  }

  return <UsersPageClient currentUser={session.user} />;
}
