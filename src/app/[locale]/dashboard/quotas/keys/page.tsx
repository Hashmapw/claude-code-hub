import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";

export default async function KeysQuotaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return <ClientRedirect to={session ? "/dashboard/my-quota" : "/login"} locale={locale} />;
  }

  return <ClientRedirect to="/dashboard/quotas/users" locale={locale} />;
}
