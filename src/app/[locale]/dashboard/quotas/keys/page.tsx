// This page has been deprecated. Key-level quotas are now managed at user level.
// Users should visit /dashboard/quotas/users instead.
// Redirecting to user quotas page...

import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";

export default async function KeysQuotaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // Permission check: only admin users can access
  if (!session || session.user.role !== "admin") {
    return <ClientRedirect to={session ? "/dashboard/my-quota" : "/login"} locale={locale} />;
  }

  return <ClientRedirect to="/dashboard/quotas/users" locale={locale} />;
}
