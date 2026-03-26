import { RootLocaleRedirect } from "@/components/root-locale-redirect";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  return <RootLocaleRedirect to="dashboard" />;
}
