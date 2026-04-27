import { NextResponse } from "next/server";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";
import { getSystemSettings } from "@/repository/system-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSystemSettings();
    return NextResponse.json({ siteTitle: settings.siteTitle || DEFAULT_SITE_TITLE });
  } catch {
    return NextResponse.json({ siteTitle: DEFAULT_SITE_TITLE });
  }
}
