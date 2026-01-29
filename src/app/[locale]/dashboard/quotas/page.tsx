import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";

export default async function QuotasPage({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const session = await getSession();
  if (!session) {
    return <ClientRedirect to="/login" locale={locale} />;
  }

  if (session.user.role !== "admin") {
    return <ClientRedirect to="/dashboard/my-quota" locale={locale} />;
  }

  return <ClientRedirect to="/dashboard/quotas/users" locale={locale} />;
}
