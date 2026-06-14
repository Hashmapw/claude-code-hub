import { type SQL, sql } from "drizzle-orm";
import { messageRequest, usageLedger } from "@/drizzle/schema";
import type { BillingModelSource } from "@/types/system-config";

export function buildMessageBillingModelField(
  source: BillingModelSource = "original"
): SQL<string | null> {
  return source === "original"
    ? sql<string | null>`COALESCE(${messageRequest.originalModel}, ${messageRequest.model})`
    : sql<string | null>`COALESCE(${messageRequest.model}, ${messageRequest.originalModel})`;
}

export function buildLedgerBillingModelField(
  source: BillingModelSource = "original"
): SQL<string | null> {
  return source === "original"
    ? sql<string | null>`COALESCE(${usageLedger.originalModel}, ${usageLedger.model})`
    : sql<string | null>`COALESCE(${usageLedger.model}, ${usageLedger.originalModel})`;
}
