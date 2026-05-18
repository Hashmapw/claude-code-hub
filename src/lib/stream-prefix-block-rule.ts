import type { ErrorOverrideResponse, ErrorRule } from "@/repository/error-rules";

export const STREAM_PREFIX_BLOCK_CATEGORY = "stream_prefix_block";
export const STREAM_PREFIX_BLOCK_DEFAULT_MESSAGE_CODE = "STREAM_PREFIX_BLOCKED";
export const DEFAULT_STREAM_PREFIX_SCAN_LIMIT_BYTES = 64 * 1024;
export const STREAM_PREFIX_SCAN_LIMIT_32KB = 32 * 1024;
export const STREAM_PREFIX_SCAN_LIMIT_64KB = 64 * 1024;

export const STREAM_PREFIX_BLOCK_ERROR_CODES = {
  DESCRIPTION_OBJECT_REQUIRED: "STREAM_PREFIX_BLOCK_DESCRIPTION_OBJECT_REQUIRED",
  DESCRIPTION_INVALID_JSON: "STREAM_PREFIX_BLOCK_DESCRIPTION_INVALID_JSON",
  SCAN_LIMIT_INVALID: "STREAM_PREFIX_BLOCK_SCAN_LIMIT_INVALID",
  KEYWORDS_INVALID: "STREAM_PREFIX_BLOCK_KEYWORDS_INVALID",
  PROVIDER_IDS_INVALID: "STREAM_PREFIX_BLOCK_PROVIDER_IDS_INVALID",
  STATUS_CODE_INVALID: "STREAM_PREFIX_BLOCK_STATUS_CODE_INVALID",
  MESSAGE_INVALID: "STREAM_PREFIX_BLOCK_MESSAGE_INVALID",
} as const;

export type StreamPrefixBlockErrorCode =
  (typeof STREAM_PREFIX_BLOCK_ERROR_CODES)[keyof typeof STREAM_PREFIX_BLOCK_ERROR_CODES];

const STREAM_PREFIX_BLOCK_ERROR_MESSAGES: Record<StreamPrefixBlockErrorCode, string> = {
  STREAM_PREFIX_BLOCK_DESCRIPTION_OBJECT_REQUIRED: "description 必须是 JSON 对象",
  STREAM_PREFIX_BLOCK_DESCRIPTION_INVALID_JSON: "description 必须是合法 JSON",
  STREAM_PREFIX_BLOCK_SCAN_LIMIT_INVALID: "scanLimitBytes 必须是大于 0 的整数",
  STREAM_PREFIX_BLOCK_KEYWORDS_INVALID: "keywords 必须是非空字符串数组",
  STREAM_PREFIX_BLOCK_PROVIDER_IDS_INVALID: "providerIds 必须是正整数数组",
  STREAM_PREFIX_BLOCK_STATUS_CODE_INVALID: "statusCode 必须是 400-599 范围内的整数",
  STREAM_PREFIX_BLOCK_MESSAGE_INVALID: "message 必须是非空字符串",
};

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
  hasExplicitMessage?: boolean;
  overrideResponse: ErrorOverrideResponse | null;
  overrideStatusCode: number | null;
  description: string | null;
}

type DescriptionParseResult =
  | { ok: true; value: StreamPrefixBlockDescriptionInput | null }
  | { ok: false; error: string; errorCode: StreamPrefixBlockErrorCode };

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
  return STREAM_PREFIX_BLOCK_DEFAULT_MESSAGE_CODE;
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
      return {
        ok: false,
        error: STREAM_PREFIX_BLOCK_ERROR_MESSAGES.STREAM_PREFIX_BLOCK_DESCRIPTION_OBJECT_REQUIRED,
        errorCode: STREAM_PREFIX_BLOCK_ERROR_CODES.DESCRIPTION_OBJECT_REQUIRED,
      };
    }
    return {
      ok: true,
      value: parsed as StreamPrefixBlockDescriptionInput,
    };
  } catch {
    return {
      ok: false,
      error: STREAM_PREFIX_BLOCK_ERROR_MESSAGES.STREAM_PREFIX_BLOCK_DESCRIPTION_INVALID_JSON,
      errorCode: STREAM_PREFIX_BLOCK_ERROR_CODES.DESCRIPTION_INVALID_JSON,
    };
  }
}

export function validateStreamPrefixBlockDescriptionCode(
  description: string | null | undefined
): StreamPrefixBlockErrorCode | null {
  const parsed = parseStreamPrefixBlockDescription(description);
  if (!parsed.ok) {
    return parsed.errorCode;
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
    return STREAM_PREFIX_BLOCK_ERROR_CODES.SCAN_LIMIT_INVALID;
  }

  if (value.keywords !== undefined) {
    if (!Array.isArray(value.keywords) || normalizeKeywords(value.keywords).length === 0) {
      return STREAM_PREFIX_BLOCK_ERROR_CODES.KEYWORDS_INVALID;
    }
  }

  if (value.providerIds !== undefined) {
    if (!Array.isArray(value.providerIds) || normalizeProviderIds(value.providerIds) === null) {
      return STREAM_PREFIX_BLOCK_ERROR_CODES.PROVIDER_IDS_INVALID;
    }

    for (const entry of value.providerIds) {
      if (!Number.isInteger(entry) || (entry as number) <= 0) {
        return STREAM_PREFIX_BLOCK_ERROR_CODES.PROVIDER_IDS_INVALID;
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
    return STREAM_PREFIX_BLOCK_ERROR_CODES.STATUS_CODE_INVALID;
  }

  if (value.message !== undefined && (typeof value.message !== "string" || !value.message.trim())) {
    return STREAM_PREFIX_BLOCK_ERROR_CODES.MESSAGE_INVALID;
  }

  return null;
}

export function getStreamPrefixBlockErrorMessage(errorCode: StreamPrefixBlockErrorCode): string {
  return STREAM_PREFIX_BLOCK_ERROR_MESSAGES[errorCode];
}

export function validateStreamPrefixBlockDescription(
  description: string | null | undefined
): string | null {
  const errorCode = validateStreamPrefixBlockDescriptionCode(description);
  return errorCode ? getStreamPrefixBlockErrorMessage(errorCode) : null;
}

export function resolveStreamPrefixBlockRule(
  rule: StreamPrefixBlockRule
): ResolvedStreamPrefixBlockRule | null {
  if (rule.category !== STREAM_PREFIX_BLOCK_CATEGORY) {
    return null;
  }

  const parsed = parseStreamPrefixBlockDescription(rule.description);
  if (!parsed.ok) {
    return null;
  }
  const config = parsed.value;
  const keywords = normalizeKeywords(config?.keywords);
  const effectiveKeywords = keywords.length > 0 ? keywords : [rule.pattern.trim()].filter(Boolean);
  const hasExplicitMessage =
    typeof config?.message === "string" && config.message.trim().length > 0;

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
    hasExplicitMessage,
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

  const whitespaceInsensitiveText = normalizeStreamPrefixBlockMatchText(text);
  if (!whitespaceInsensitiveText) {
    return null;
  }

  for (let index = 0; index < rule.keywords.length; index += 1) {
    const whitespaceInsensitiveKeyword = normalizeStreamPrefixBlockMatchText(
      rule.keywords[index] ?? rule.pattern
    );
    if (
      whitespaceInsensitiveKeyword &&
      whitespaceInsensitiveText.includes(whitespaceInsensitiveKeyword)
    ) {
      return rule.keywords[index] ?? rule.pattern;
    }
  }

  return null;
}

function normalizeStreamPrefixBlockMatchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
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
