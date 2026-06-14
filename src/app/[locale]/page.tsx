import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;
  return redirectWithWorkspaceBase("/dashboard", locale);
}
