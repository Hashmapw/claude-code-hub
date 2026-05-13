import { describe, expect, test } from "vitest";
import { resolveLegacySearchTerm } from "@/lib/users/legacy-search-term";

describe("resolveLegacySearchTerm", () => {
  test("优先使用 searchTerm 的非空白值", () => {
    expect(
      resolveLegacySearchTerm({
        searchTerm: "  alice  ",
        query: "bob",
        keyword: "carol",
      })
    ).toBe("alice");
  });

  test("searchTerm 为空白时回退到 query", () => {
    expect(
      resolveLegacySearchTerm({
        searchTerm: "   ",
        query: "  bob  ",
        keyword: "carol",
      })
    ).toBe("bob");
  });

  test("searchTerm 与 query 都为空白时回退到 keyword", () => {
    expect(
      resolveLegacySearchTerm({
        searchTerm: "   ",
        query: "",
        keyword: "  carol  ",
      })
    ).toBe("carol");
  });

  test("全部为空时返回 undefined", () => {
    expect(
      resolveLegacySearchTerm({
        searchTerm: " ",
        query: undefined,
        keyword: "\t",
      })
    ).toBeUndefined();
  });
});
