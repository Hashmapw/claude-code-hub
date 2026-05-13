import { describe, expect, it } from "vitest";
import { resolveHttpStatusText } from "@/app/v1/_lib/proxy/status-text";

describe("resolveHttpStatusText", () => {
  it("标准状态码应写入对应的 statusText（例如 200 -> OK）", () => {
    expect(resolveHttpStatusText(200)).toBe("OK");
  });

  it("未知/非标准状态码不应兜底为 OK（避免误导）", () => {
    expect(resolveHttpStatusText(499)).toBe("");
  });
});
