import { RootLocaleRedirect } from "@/components/root-locale-redirect";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  await params;
  return <RootLocaleRedirect to="dashboard" />;
}
