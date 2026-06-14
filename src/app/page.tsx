import { cookies } from "next/headers";
import { defaultLocale, localeCookieName } from "@/i18n/config";
import { getLocaleFromValue } from "@/i18n/pathname";
import { redirectWithWorkspaceBase } from "@/lib/utils/workspace-aware-redirect";

export default async function RootPage() {
  const cookieStore = await cookies();
  const locale = getLocaleFromValue(cookieStore.get(localeCookieName)?.value) || defaultLocale;

  await redirectWithWorkspaceBase("/dashboard", locale);
}
