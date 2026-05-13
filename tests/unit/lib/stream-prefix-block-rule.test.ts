import { describe, expect, test } from "vitest";
import {
  DEFAULT_STREAM_PREFIX_SCAN_LIMIT_BYTES,
  formatStreamPrefixBlockRuleSummary,
  resolveStreamPrefixBlockRule,
  ruleAppliesToProvider,
  STREAM_PREFIX_BLOCK_CATEGORY,
  validateStreamPrefixBlockDescription,
} from "@/lib/stream-prefix-block-rule";

describe("stream-prefix-block-rule", () => {
  test("validates description json for stream prefix block rules", () => {
    expect(
      validateStreamPrefixBlockDescription(
        JSON.stringify({
          scanLimitBytes: 4096,
          keywords: ["175877552"],
          providerIds: [1, 2, 3],
          statusCode: 403,
          message: "blocked",
        })
      )
    ).toBeNull();

    expect(validateStreamPrefixBlockDescription("{")).toBe("description 必须是合法 JSON");
    expect(validateStreamPrefixBlockDescription(JSON.stringify({ scanLimitBytes: 0 }))).toBe(
      "scanLimitBytes 必须是大于 0 的整数"
    );
    expect(
      validateStreamPrefixBlockDescription(JSON.stringify({ scanLimitBytes: 12345 }))
    ).toBeNull();
    expect(validateStreamPrefixBlockDescription(JSON.stringify({ keywords: [] }))).toBe(
      "keywords 必须是非空字符串数组"
    );
  });

  test("resolves stream prefix block rule from description json", () => {
    const resolved = resolveStreamPrefixBlockRule({
      id: 7,
      pattern: "175877552",
      category: STREAM_PREFIX_BLOCK_CATEGORY,
      description: JSON.stringify({
        scanLimitBytes: 2048,
        keywords: ["175877552", "公益token通知群"],
        providerIds: [3, 1, 3],
        statusCode: 451,
        message: "custom blocked",
      }),
      overrideResponse: null,
      overrideStatusCode: null,
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.scanLimitBytes).toBe(2048);
    expect(resolved?.keywords).toEqual(["175877552", "公益token通知群"]);
    expect(resolved?.providerIds).toEqual([1, 3]);
    expect(resolved?.statusCode).toBe(451);
    expect(resolved?.message).toBe("custom blocked");
    expect(ruleAppliesToProvider(resolved!, 1)).toBe(true);
    expect(ruleAppliesToProvider(resolved!, 2)).toBe(false);
  });

  test("falls back to pattern and default scan size when description is empty", () => {
    const resolved = resolveStreamPrefixBlockRule({
      id: 8,
      pattern: "175877552",
      category: STREAM_PREFIX_BLOCK_CATEGORY,
      description: null,
      overrideResponse: null,
      overrideStatusCode: null,
    });

    expect(resolved?.keywords).toEqual(["175877552"]);
    expect(resolved?.scanLimitBytes).toBe(DEFAULT_STREAM_PREFIX_SCAN_LIMIT_BYTES);
    expect(resolved?.providerIds).toBeNull();
    expect(resolved?.statusCode).toBe(403);
  });

  test("formats stream prefix block summary for arbitrary byte sizes", () => {
    expect(
      formatStreamPrefixBlockRuleSummary({
        pattern: "175877552",
        category: STREAM_PREFIX_BLOCK_CATEGORY,
        description: JSON.stringify({
          scanLimitBytes: 1536,
          keywords: ["175877552"],
          providerIds: [9],
        }),
      })
    ).toBe("scan=1536B; providers=9; keywords=175877552");

    expect(
      formatStreamPrefixBlockRuleSummary({
        pattern: "175877552",
        category: STREAM_PREFIX_BLOCK_CATEGORY,
        description: JSON.stringify({
          scanLimitBytes: 4096,
          keywords: ["175877552"],
        }),
      })
    ).toBe("scan=4KB; providers=all; keywords=175877552");
  });
});
