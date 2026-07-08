import { afterEach, describe, expect, it, vi } from "vitest";

describe("SII proxy support feature flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled by default so existing Notebook deployments keep working", async () => {
    vi.stubEnv("SII_PROXY_SUPPORT", undefined);
    vi.stubEnv("NEXT_PUBLIC_SII_PROXY_SUPPORT", undefined);

    const { isSiiProxySupportEnabled } = await import("@/lib/utils/sii-proxy-support");

    expect(isSiiProxySupportEnabled()).toBe(true);
  });

  it.each(["0", "false", "no", "off", "disabled"])("can be disabled with %s", async (value) => {
    vi.stubEnv("SII_PROXY_SUPPORT", value);
    vi.stubEnv("NEXT_PUBLIC_SII_PROXY_SUPPORT", undefined);

    const { isSiiProxySupportEnabled } = await import("@/lib/utils/sii-proxy-support");

    expect(isSiiProxySupportEnabled()).toBe(false);
  });

  it("prefers NEXT_PUBLIC_SII_PROXY_SUPPORT for browser-side code", async () => {
    vi.stubEnv("SII_PROXY_SUPPORT", "false");
    vi.stubEnv("NEXT_PUBLIC_SII_PROXY_SUPPORT", "true");

    const { isSiiProxySupportEnabled } = await import("@/lib/utils/sii-proxy-support");

    expect(isSiiProxySupportEnabled()).toBe(true);
  });
});
