import { ClientRedirect } from "@/components/client-redirect";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ClientRedirect to="/dashboard" locale={locale} />;
}
