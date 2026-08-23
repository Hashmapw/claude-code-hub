"use client";

import { NumberField } from "@/components/form/form-field";
import { FormGrid } from "@/components/form/form-layout";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type StreamUsageAdjustmentFieldTranslations = {
  label: string;
  descriptionEnabled: string;
  descriptionDisabled: string;
  probabilityLabel: string;
  probabilityDescription: string;
  inputRatioLabel: string;
  outputRatioLabel: string;
  cacheReadRatioLabel: string;
  cacheCreationRatioLabel: string;
  ratioDescription: string;
  example: string;
};

export type StreamUsageAdjustmentFormValues = {
  streamUsageAdjustmentEnabled?: boolean;
  streamUsageAdjustmentProbability?: number | string;
  streamUsageAdjustmentInputTokensRatio?: number | string;
  streamUsageAdjustmentOutputTokensRatio?: number | string;
  streamUsageAdjustmentCacheReadInputTokensRatio?: number | string;
  streamUsageAdjustmentCacheCreationInputTokensRatio?: number | string;
};

export type StreamUsageAdjustmentFieldsProps = {
  idPrefix: string;
  values: StreamUsageAdjustmentFormValues;
  onChange: (field: keyof StreamUsageAdjustmentFormValues, value: boolean | number) => void;
  translations: StreamUsageAdjustmentFieldTranslations;
  errors?: Partial<Record<keyof StreamUsageAdjustmentFormValues, string | undefined>>;
  isAdmin: boolean;
};

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function StreamUsageAdjustmentFields({
  idPrefix,
  values,
  onChange,
  translations,
  errors,
  isAdmin,
}: StreamUsageAdjustmentFieldsProps) {
  if (!isAdmin) {
    return null;
  }

  const enabled = values.streamUsageAdjustmentEnabled ?? false;
  const numberProps = (
    field: keyof StreamUsageAdjustmentFormValues,
    fallback: number,
    max: number
  ) => ({
    value: asNumber(values[field], fallback),
    onChange: (nextValue: string) => onChange(field, asNumber(nextValue, fallback)),
    error: errors?.[field],
    touched: Boolean(errors?.[field]),
    min: 0,
    max,
    step: 1,
    disabled: !enabled,
  });

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border bg-background px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor={`${idPrefix}-stream-usage-adjustment`} className="text-sm font-medium">
            {translations.label}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {enabled ? translations.descriptionEnabled : translations.descriptionDisabled}
          </p>
        </div>
        <Switch
          id={`${idPrefix}-stream-usage-adjustment`}
          checked={enabled}
          onCheckedChange={(checked) => onChange("streamUsageAdjustmentEnabled", checked)}
        />
      </div>

      <p className="text-xs text-muted-foreground">{translations.example}</p>

      <NumberField
        label={translations.probabilityLabel}
        description={translations.probabilityDescription}
        {...numberProps("streamUsageAdjustmentProbability", 100, 100)}
      />

      <FormGrid columns={2}>
        <NumberField
          label={translations.inputRatioLabel}
          description={translations.ratioDescription}
          {...numberProps("streamUsageAdjustmentInputTokensRatio", 100, 10_000)}
        />
        <NumberField
          label={translations.outputRatioLabel}
          description={translations.ratioDescription}
          {...numberProps("streamUsageAdjustmentOutputTokensRatio", 100, 10_000)}
        />
        <NumberField
          label={translations.cacheReadRatioLabel}
          description={translations.ratioDescription}
          {...numberProps("streamUsageAdjustmentCacheReadInputTokensRatio", 100, 10_000)}
        />
        <NumberField
          label={translations.cacheCreationRatioLabel}
          description={translations.ratioDescription}
          {...numberProps("streamUsageAdjustmentCacheCreationInputTokensRatio", 100, 10_000)}
        />
      </FormGrid>
    </div>
  );
}
