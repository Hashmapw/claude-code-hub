import { describe, expect, it } from "vitest";
import { resolvePublicStatusVendorIconKey } from "@/lib/public-status/vendor-icon-key";

describe("resolvePublicStatusVendorIconKey", () => {
  it("resolves MiMo model prefixes to the custom mimo icon key", () => {
    expect(
      resolvePublicStatusVendorIconKey({
        modelName: "mimo-vl-7b",
        vendorIconKey: "generic",
      })
    ).toBe("mimo");
  });

  it("accepts explicit mimo vendor icon keys", () => {
    expect(
      resolvePublicStatusVendorIconKey({
        modelName: "custom-model",
        vendorIconKey: "mimo",
      })
    ).toBe("mimo");
  });
});
