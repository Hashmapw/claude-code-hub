import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";
import { UsersPageClient } from "./users-page-client";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // Permission check: allow all logged-in users to access
  if (!session) {
    return <ClientRedirect to="/login" locale={locale} />;
  }

  // TypeScript: session is guaranteed to be non-null after the redirect check
  return <UsersPageClient currentUser={session.user} />;
}
