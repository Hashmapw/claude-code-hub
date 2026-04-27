import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { buildUsageLogConditions } from "@/repository/_shared/usage-log-filters";

function sqlToString(sqlObj: SQL): string {
  return sqlObj.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (num: number, _value: unknown) => `$${num}`,
    escapeString: (value: string) => `'${value}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  }).sql;
}

describe("usage log model source filter", () => {
  it("uses COALESCE(originalModel, model) when billingModelSource=original", () => {
    const [condition] = buildUsageLogConditions({ model: "claude-3" }, "original");
    const whereSql = sqlToString(condition).toLowerCase();

    expect(whereSql).toContain("coalesce");
    expect(whereSql).toContain("original_model");
    expect(whereSql).toContain("model");
  });

  it("uses redirected model column directly when billingModelSource=redirected", () => {
    const [condition] = buildUsageLogConditions({ model: "claude-3" }, "redirected");
    const whereSql = sqlToString(condition).toLowerCase();

    expect(whereSql).not.toContain("coalesce");
    expect(whereSql).toContain('"message_request"."model"');
  });
});
