import type { ReactNode } from "react";
import { ClientRedirect } from "@/components/client-redirect";
import { getSession } from "@/lib/auth";

export default async function MyUsageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession({ allowReadOnlyAccess: true });

  if (!session) {
    return <ClientRedirect to="/login?from=/my-usage" locale={locale} />;
  }

  if (session.user.role === "admin" || session.key.canLoginWebUi) {
    return <ClientRedirect to="/dashboard" locale={locale} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
