import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";
import { DataGeneratorPage } from "./_components/data-generator-page";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirectWithWorkspaceBase("/login", locale);
  }

  return <DataGeneratorPage />;
}
