import { ClientRedirect } from "@/components/client-redirect";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;
  return <ClientRedirect to="/dashboard" locale={locale} />;
}
