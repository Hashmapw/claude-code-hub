export type StreamUsageAdjustmentConfig = {
  enabled: boolean;
  /** Request-level hit probability in percent. 100 means always apply. */
  probability: number;
  /** Token rewrite ratios in percent. 100 means unchanged. */
  inputTokensRatio: number;
  outputTokensRatio: number;
  cacheReadInputTokensRatio: number;
  cacheCreationInputTokensRatio: number;
};

export const DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG: StreamUsageAdjustmentConfig = {
  enabled: false,
  probability: 100,
  inputTokensRatio: 100,
  outputTokensRatio: 100,
  cacheReadInputTokensRatio: 100,
  cacheCreationInputTokensRatio: 100,
};

function finiteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeStreamUsageAdjustmentConfig(
  value: unknown
): StreamUsageAdjustmentConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    probability: clamp(
      finiteNumber(record.probability, DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.probability),
      0,
      100
    ),
    inputTokensRatio: clamp(
      finiteNumber(
        record.inputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.inputTokensRatio
      ),
      0,
      10_000
    ),
    outputTokensRatio: clamp(
      finiteNumber(
        record.outputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.outputTokensRatio
      ),
      0,
      10_000
    ),
    cacheReadInputTokensRatio: clamp(
      finiteNumber(
        record.cacheReadInputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.cacheReadInputTokensRatio
      ),
      0,
      10_000
    ),
    cacheCreationInputTokensRatio: clamp(
      finiteNumber(
        record.cacheCreationInputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.cacheCreationInputTokensRatio
      ),
      0,
      10_000
    ),
  };
}

export function buildStreamUsageAdjustmentConfigFromForm(input: {
  streamUsageAdjustmentEnabled?: boolean;
  streamUsageAdjustmentProbability?: number | string | null;
  streamUsageAdjustmentInputTokensRatio?: number | string | null;
  streamUsageAdjustmentOutputTokensRatio?: number | string | null;
  streamUsageAdjustmentCacheReadInputTokensRatio?: number | string | null;
  streamUsageAdjustmentCacheCreationInputTokensRatio?: number | string | null;
}): StreamUsageAdjustmentConfig {
  return {
    enabled: input.streamUsageAdjustmentEnabled === true,
    probability: clamp(
      finiteNumber(
        input.streamUsageAdjustmentProbability,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.probability
      ),
      0,
      100
    ),
    inputTokensRatio: clamp(
      finiteNumber(
        input.streamUsageAdjustmentInputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.inputTokensRatio
      ),
      0,
      10_000
    ),
    outputTokensRatio: clamp(
      finiteNumber(
        input.streamUsageAdjustmentOutputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.outputTokensRatio
      ),
      0,
      10_000
    ),
    cacheReadInputTokensRatio: clamp(
      finiteNumber(
        input.streamUsageAdjustmentCacheReadInputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.cacheReadInputTokensRatio
      ),
      0,
      10_000
    ),
    cacheCreationInputTokensRatio: clamp(
      finiteNumber(
        input.streamUsageAdjustmentCacheCreationInputTokensRatio,
        DEFAULT_STREAM_USAGE_ADJUSTMENT_CONFIG.cacheCreationInputTokensRatio
      ),
      0,
      10_000
    ),
  };
}
