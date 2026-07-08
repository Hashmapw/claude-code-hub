import { describe, expect, it } from "vitest";
import { resolvePublicStatusVendorIconKey } from "@/lib/public-status/vendor-icon-key";

describe("resolvePublicStatusVendorIconKey", () => {
  it("resolves MiMo model prefixes to the Xiaomi icon key", () => {
    expect(
      resolvePublicStatusVendorIconKey({
        modelName: "mimo-vl-7b",
        vendorIconKey: "generic",
      })
    ).toBe("xiaomi");
  });

  it("accepts explicit Xiaomi and MiMo vendor icon keys", () => {
    expect(
      resolvePublicStatusVendorIconKey({
        modelName: "custom-model",
        vendorIconKey: "xiaomi",
      })
    ).toBe("xiaomi");
  });

  it("maps explicit mimo vendor icon keys to Xiaomi", () => {
    expect(
      resolvePublicStatusVendorIconKey({
        modelName: "custom-model",
        vendorIconKey: "mimo",
      })
    ).toBe("xiaomi");
  });
});
