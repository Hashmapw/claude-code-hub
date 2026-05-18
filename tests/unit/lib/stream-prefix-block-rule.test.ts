import { describe, expect, test } from "vitest";
import {
  DEFAULT_STREAM_PREFIX_SCAN_LIMIT_BYTES,
  findMatchedStreamPrefixKeyword,
  formatStreamPrefixBlockRuleSummary,
  resolveStreamPrefixBlockRule,
  ruleAppliesToProvider,
  STREAM_PREFIX_BLOCK_CATEGORY,
  STREAM_PREFIX_BLOCK_DEFAULT_MESSAGE_CODE,
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
    expect(validateStreamPrefixBlockDescription(JSON.stringify({ providerIds: [] }))).toBe(
      "providerIds 必须是正整数数组"
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
    expect(resolved?.hasExplicitMessage).toBe(true);
    expect(ruleAppliesToProvider(resolved!, 1)).toBe(true);
    expect(ruleAppliesToProvider(resolved!, 2)).toBe(false);
  });

  test("ignores rules with invalid description json at runtime", () => {
    const resolved = resolveStreamPrefixBlockRule({
      id: 6,
      pattern: "175877552",
      category: STREAM_PREFIX_BLOCK_CATEGORY,
      description: "{",
      overrideResponse: null,
      overrideStatusCode: null,
    });

    expect(resolved).toBeNull();
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
    expect(resolved?.message).toBe(STREAM_PREFIX_BLOCK_DEFAULT_MESSAGE_CODE);
    expect(resolved?.hasExplicitMessage).toBe(false);
  });

  test("overrideStatusCode has priority over description statusCode", () => {
    const resolved = resolveStreamPrefixBlockRule({
      id: 9,
      pattern: "175877552",
      category: STREAM_PREFIX_BLOCK_CATEGORY,
      description: JSON.stringify({ statusCode: 451, message: "blocked" }),
      overrideResponse: null,
      overrideStatusCode: 429,
    });

    expect(resolved?.statusCode).toBe(429);
  });

  test("matches stream prefix keywords across whitespace and line breaks", () => {
    const resolved = resolveStreamPrefixBlockRule({
      id: 10,
      pattern: "公益token通知群",
      category: STREAM_PREFIX_BLOCK_CATEGORY,
      description: JSON.stringify({
        keywords: ["公益token通知群", "175877552"],
      }),
      overrideResponse: null,
      overrideStatusCode: null,
    });

    expect(resolved).not.toBeNull();
    expect(findMatchedStreamPrefixKeyword("data: 公益 token\n通知\t群\n\n", resolved!)).toBe(
      "公益token通知群"
    );
    expect(findMatchedStreamPrefixKeyword("data: 175 877 552\n\n", resolved!)).toBe("175877552");
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
