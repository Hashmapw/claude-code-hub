import type { ErrorOverrideResponse, ErrorRule } from "@/repository/error-rules";

export const STREAM_PREFIX_BLOCK_CATEGORY = "stream_prefix_block";
export const DEFAULT_STREAM_PREFIX_SCAN_LIMIT_BYTES = 64 * 1024;
export const STREAM_PREFIX_SCAN_LIMIT_32KB = 32 * 1024;
export const STREAM_PREFIX_SCAN_LIMIT_64KB = 64 * 1024;

type StreamPrefixBlockDescriptionInput = {
  scanLimitBytes?: unknown;
  keywords?: unknown;
  providerIds?: unknown;
  statusCode?: unknown;
  message?: unknown;
};

export interface StreamPrefixBlockRuleDescription {
  scanLimitBytes?: number;
  keywords?: string[];
  providerIds?: number[];
  statusCode?: number;
  message?: string;
}

export interface StreamPrefixBlockRule {
  id: number;
  pattern: string;
  category: string;
  description: string | null;
  overrideResponse: ErrorOverrideResponse | null;
  overrideStatusCode: number | null;
}

export interface ResolvedStreamPrefixBlockRule {
  id: number;
  pattern: string;
  keywords: string[];
  normalizedKeywords: string[];
  providerIds: number[] | null;
  scanLimitBytes: number;
  statusCode: number;
  message: string;
  overrideResponse: ErrorOverrideResponse | null;
  overrideStatusCode: number | null;
  description: string | null;
}

type DescriptionParseResult =
  | { ok: true; value: StreamPrefixBlockDescriptionInput | null }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
  }

  return Array.from(deduped);
}

function normalizeProviderIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const deduped = new Set<number>();
  for (const entry of value) {
    if (!Number.isInteger(entry) || (entry as number) <= 0) {
      continue;
    }
    deduped.add(entry as number);
  }

  const ids = Array.from(deduped).sort((a, b) => a - b);
  return ids.length > 0 ? ids : null;
}

function normalizeScanLimitBytes(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return DEFAULT_STREAM_PREFIX_SCAN_LIMIT_BYTES;
}

function normalizeStatusCode(inlineStatusCode: unknown, overrideStatusCode: number | null): number {
  if (
    overrideStatusCode != null &&
    Number.isInteger(overrideStatusCode) &&
    overrideStatusCode >= 400 &&
    overrideStatusCode <= 599
  ) {
    return overrideStatusCode;
  }

  if (
    typeof inlineStatusCode === "number" &&
    Number.isInteger(inlineStatusCode) &&
    inlineStatusCode >= 400 &&
    inlineStatusCode <= 599
  ) {
    return inlineStatusCode;
  }

  return 403;
}

function normalizeMessage(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "Response blocked by stream prefix policy";
}

export function parseStreamPrefixBlockDescription(
  description: string | null | undefined
): DescriptionParseResult {
  const text = description?.trim();
  if (!text) {
    return { ok: true, value: null };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isPlainObject(parsed)) {
      return { ok: false, error: "description 必须是 JSON 对象" };
    }
    return {
      ok: true,
      value: parsed as StreamPrefixBlockDescriptionInput,
    };
  } catch {
    return { ok: false, error: "description 必须是合法 JSON" };
  }
}

export function validateStreamPrefixBlockDescription(
  description: string | null | undefined
): string | null {
  const parsed = parseStreamPrefixBlockDescription(description);
  if (!parsed.ok) {
    return parsed.error;
  }

  const value = parsed.value;
  if (!value) {
    return null;
  }

  if (
    value.scanLimitBytes !== undefined &&
    !(
      typeof value.scanLimitBytes === "number" &&
      Number.isInteger(value.scanLimitBytes) &&
      value.scanLimitBytes > 0
    )
  ) {
    return "scanLimitBytes 必须是大于 0 的整数";
  }

  if (value.keywords !== undefined) {
    if (!Array.isArray(value.keywords) || normalizeKeywords(value.keywords).length === 0) {
      return "keywords 必须是非空字符串数组";
    }
  }

  if (value.providerIds !== undefined) {
    if (!Array.isArray(value.providerIds)) {
      return "providerIds 必须是正整数数组";
    }

    for (const entry of value.providerIds) {
      if (!Number.isInteger(entry) || (entry as number) <= 0) {
        return "providerIds 必须是正整数数组";
      }
    }
  }

  if (
    value.statusCode !== undefined &&
    !(
      typeof value.statusCode === "number" &&
      Number.isInteger(value.statusCode) &&
      value.statusCode >= 400 &&
      value.statusCode <= 599
    )
  ) {
    return "statusCode 必须是 400-599 范围内的整数";
  }

  if (value.message !== undefined && (typeof value.message !== "string" || !value.message.trim())) {
    return "message 必须是非空字符串";
  }

  return null;
}

export function resolveStreamPrefixBlockRule(
  rule: StreamPrefixBlockRule
): ResolvedStreamPrefixBlockRule | null {
  if (rule.category !== STREAM_PREFIX_BLOCK_CATEGORY) {
    return null;
  }

  const parsed = parseStreamPrefixBlockDescription(rule.description);
  const config = parsed.ok ? parsed.value : null;
  const keywords = normalizeKeywords(config?.keywords);
  const effectiveKeywords = keywords.length > 0 ? keywords : [rule.pattern.trim()].filter(Boolean);

  if (effectiveKeywords.length === 0) {
    return null;
  }

  return {
    id: rule.id,
    pattern: rule.pattern,
    keywords: effectiveKeywords,
    normalizedKeywords: effectiveKeywords.map((keyword) => keyword.toLowerCase()),
    providerIds: normalizeProviderIds(config?.providerIds),
    scanLimitBytes: normalizeScanLimitBytes(config?.scanLimitBytes),
    statusCode: normalizeStatusCode(config?.statusCode, rule.overrideStatusCode),
    message: normalizeMessage(config?.message),
    overrideResponse: rule.overrideResponse,
    overrideStatusCode: rule.overrideStatusCode,
    description: rule.description,
  };
}

export function ruleAppliesToProvider(
  rule: ResolvedStreamPrefixBlockRule,
  providerId: number | null | undefined
): boolean {
  if (!rule.providerIds || rule.providerIds.length === 0) {
    return true;
  }

  if (providerId == null) {
    return false;
  }

  return rule.providerIds.includes(providerId);
}

export function findMatchedStreamPrefixKeyword(
  text: string,
  rule: ResolvedStreamPrefixBlockRule
): string | null {
  if (!text) {
    return null;
  }

  const normalizedText = text.toLowerCase();
  for (let index = 0; index < rule.normalizedKeywords.length; index += 1) {
    if (normalizedText.includes(rule.normalizedKeywords[index]!)) {
      return rule.keywords[index] ?? rule.pattern;
    }
  }

  return null;
}

export function formatStreamPrefixBlockRuleSummary(
  rule: Pick<ErrorRule, "pattern" | "description" | "category">
): string | null {
  const resolved = resolveStreamPrefixBlockRule({
    id: 0,
    pattern: rule.pattern,
    category: rule.category,
    description: rule.description ?? null,
    overrideResponse: null,
    overrideStatusCode: null,
  });

  if (!resolved) {
    return null;
  }

  const sizeLabel =
    resolved.scanLimitBytes % 1024 === 0
      ? `${resolved.scanLimitBytes / 1024}KB`
      : `${resolved.scanLimitBytes}B`;
  const providerLabel = resolved.providerIds?.length
    ? `providers=${resolved.providerIds.join(",")}`
    : "providers=all";
  const keywordLabel = `keywords=${resolved.keywords.join(", ")}`;

  return `scan=${sizeLabel}; ${providerLabel}; ${keywordLabel}`;
}
