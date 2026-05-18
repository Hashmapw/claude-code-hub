import { describe, expect, test, vi } from "vitest";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;

    if (typeof node === "object") {
      const anyNode = node as any;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value) {
        if (Array.isArray(anyNode.value)) {
          return anyNode.value.map(String).join("");
        }
        return String(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

function createThenableQuery<T>(result: T, whereArgs?: unknown[]) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);
  query.where = vi.fn((arg: unknown) => {
    whereArgs?.push(arg);
    return query;
  });

  return query;
}

describe("getUsedModels billing model source", () => {
  test("unions message_request and usage_ledger models with originalModel priority", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectDistinctMock = vi
      .fn()
      .mockReturnValueOnce(
        createThenableQuery([{ model: "claude-original" }, { model: "shared-model" }], whereArgs)
      )
      .mockReturnValueOnce(
        createThenableQuery(
          [{ model: "ledger-original" }, { model: "shared-model" }, { model: null }],
          whereArgs
        )
      );

    vi.doMock("@/drizzle/db", () => ({
      db: {
        selectDistinct: selectDistinctMock,
      },
    }));

    const { getUsedModels } = await import("@/repository/usage-logs");
    const models = await getUsedModels("original");

    expect(models).toEqual(["claude-original", "ledger-original", "shared-model"]);
    expect(selectDistinctMock).toHaveBeenCalledTimes(2);
    expect(sqlToString(whereArgs[0]).toLowerCase()).toContain("coalesce");
    expect(sqlToString(whereArgs[1]).toLowerCase()).toContain("coalesce");
  });
});
