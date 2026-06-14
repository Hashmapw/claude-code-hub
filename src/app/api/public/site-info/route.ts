import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  readCurrentPublicStatusConfigSnapshot,
  resolvePublicStatusSiteDescription,
} from "@/lib/public-status/config-snapshot";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_SITE_INFO_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

export async function GET() {
  try {
    const snapshot = await readCurrentPublicStatusConfigSnapshot();
    const siteTitle = snapshot?.siteTitle?.trim() || DEFAULT_SITE_TITLE;

    return NextResponse.json(
      {
        siteTitle,
        siteDescription: snapshot
          ? resolvePublicStatusSiteDescription({
              siteTitle: snapshot.siteTitle,
              siteDescription: snapshot.siteDescription,
            })
          : siteTitle,
      },
      {
        headers: {
          "Cache-Control": snapshot ? PUBLIC_SITE_INFO_CACHE_CONTROL : "no-store",
        },
      }
    );
  } catch (error) {
    logger.warn("GET /api/public/site-info failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        siteTitle: DEFAULT_SITE_TITLE,
        siteDescription: DEFAULT_SITE_TITLE,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
