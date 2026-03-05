import { NextResponse } from "next/server";
import { getSystemSettings } from "@/repository/system-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSystemSettings();
    return NextResponse.json({ siteTitle: settings.siteTitle || "Claude Code Hub" });
  } catch {
    return NextResponse.json({ siteTitle: "Claude Code Hub" });
  }
}
