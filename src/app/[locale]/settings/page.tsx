import { ClientRedirect } from "@/components/client-redirect";

import { SETTINGS_NAV_ITEMS } from "./_lib/nav-items";

export default async function SettingsIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const firstItem = SETTINGS_NAV_ITEMS[0];
  const href = firstItem?.href ?? "/dashboard";
  return <ClientRedirect to={href} locale={locale} />;
}
