import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StreamUsageAdjustmentFields,
  type StreamUsageAdjustmentFieldsProps,
} from "@/app/[locale]/dashboard/_components/user/forms/stream-usage-adjustment-fields";

const TRANSLATIONS: StreamUsageAdjustmentFieldsProps["translations"] = {
  label: "Usage adjustment",
  descriptionEnabled: "Enabled",
  descriptionDisabled: "Disabled",
  probabilityLabel: "Probability",
  probabilityDescription: "Request probability",
  inputRatioLabel: "Input ratio",
  outputRatioLabel: "Output ratio",
  cacheReadRatioLabel: "Cache read ratio",
  cacheCreationRatioLabel: "Cache creation ratio",
  ratioDescription: "Percent",
  example: "Example",
};

const mountedRoots: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

function renderComponent(props: Partial<StreamUsageAdjustmentFieldsProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onChange = props.onChange ?? vi.fn();

  act(() => {
    root.render(
      <StreamUsageAdjustmentFields
        idPrefix="test"
        isAdmin
        values={{ streamUsageAdjustmentEnabled: true }}
        onChange={onChange}
        translations={TRANSLATIONS}
        {...props}
      />
    );
  });

  const mounted = {
    container,
    onChange,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  mountedRoots.push(mounted);
  return mounted;
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("StreamUsageAdjustmentFields", () => {
  afterEach(() => {
    for (const mounted of mountedRoots.splice(0)) mounted.unmount();
  });

  it("does not render for non-admin users", () => {
    const { container } = renderComponent({ isAdmin: false });

    expect(container.innerHTML).toBe("");
  });

  it("normalizes persisted values and emits switch and number changes", () => {
    const onChange = vi.fn();
    const { container } = renderComponent({
      onChange,
      values: {
        streamUsageAdjustmentEnabled: true,
        streamUsageAdjustmentProbability: "25",
        streamUsageAdjustmentInputTokensRatio: "invalid",
        streamUsageAdjustmentOutputTokensRatio: 200,
        streamUsageAdjustmentCacheReadInputTokensRatio: 50,
        streamUsageAdjustmentCacheCreationInputTokensRatio: 300,
      },
      errors: { streamUsageAdjustmentProbability: "Invalid probability" },
    });

    const numberInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    );
    expect(numberInputs.map((input) => input.value)).toEqual(["25", "100", "200", "50", "300"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Invalid probability");

    act(() => {
      container
        .querySelector<HTMLButtonElement>("#test-stream-usage-adjustment")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      setNativeInputValue(numberInputs[0]!, "37.5");
    });

    expect(onChange).toHaveBeenCalledWith("streamUsageAdjustmentEnabled", false);
    expect(onChange).toHaveBeenCalledWith("streamUsageAdjustmentProbability", 37.5);
  });
});
