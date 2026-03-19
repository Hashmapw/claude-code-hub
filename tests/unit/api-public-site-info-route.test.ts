import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSystemSettings = vi.hoisted(() => vi.fn());

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

describe("GET /api/public/site-info", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetSystemSettings.mockReset();
  });

  it("returns the configured site title", async () => {
    mockGetSystemSettings.mockResolvedValue({ siteTitle: "My Custom Hub" });

    const { GET } = await import("@/app/api/public/site-info/route");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ siteTitle: "My Custom Hub" });
  });

  it("falls back to the default site title when settings lookup fails", async () => {
    mockGetSystemSettings.mockRejectedValue(new Error("db unavailable"));

    const { GET } = await import("@/app/api/public/site-info/route");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ siteTitle: "Claude Code Hub" });
  });
});
