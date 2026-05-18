/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUsePathname = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

import { FooterWrapper } from "@/components/customs/footer-wrapper";

describe("FooterWrapper", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it("hides footer on login path", async () => {
    mockUsePathname.mockReturnValue("/en/login");

    await act(async () => {
      root.render(
        <FooterWrapper>
          <div data-testid="footer">footer</div>
        </FooterWrapper>
      );
    });

    expect(container.querySelector('[data-testid="footer"]')).toBeNull();
  });

  it("hides footer on login path with trailing slash", async () => {
    mockUsePathname.mockReturnValue("/en/login/");

    await act(async () => {
      root.render(
        <FooterWrapper>
          <div data-testid="footer">footer</div>
        </FooterWrapper>
      );
    });

    expect(container.querySelector('[data-testid="footer"]')).toBeNull();
  });

  it("renders footer on non-login paths", async () => {
    mockUsePathname.mockReturnValue("/en/dashboard");

    await act(async () => {
      root.render(
        <FooterWrapper>
          <div data-testid="footer">footer</div>
        </FooterWrapper>
      );
    });

    expect(container.querySelector('[data-testid="footer"]')?.textContent).toBe("footer");
  });
});
