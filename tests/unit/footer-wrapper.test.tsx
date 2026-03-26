import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FooterWrapper } from "@/components/customs/footer-wrapper";

const mockUsePathname = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

describe("FooterWrapper", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    mockUsePathname.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("hides the footer on login paths", async () => {
    mockUsePathname.mockReturnValue("/zh-CN/login");

    await act(async () => {
      root.render(
        <FooterWrapper>
          <div data-testid="footer-content">footer</div>
        </FooterWrapper>
      );
    });

    expect(container.querySelector('[data-testid="footer-content"]')).toBeNull();
  });

  it("renders the footer on non-login paths", async () => {
    mockUsePathname.mockReturnValue("/zh-CN/dashboard");

    await act(async () => {
      root.render(
        <FooterWrapper>
          <div data-testid="footer-content">footer</div>
        </FooterWrapper>
      );
    });

    expect(container.querySelector('[data-testid="footer-content"]')?.textContent).toBe("footer");
  });
});
