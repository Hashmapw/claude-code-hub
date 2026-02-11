import { describe, expect, test } from "vitest";
import { getPreset, getPresetPayload } from "@/lib/provider-testing/presets";

const SESSION_MARKER = "account__session_";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function splitSessionUserId(userId: string): { prefix: string; sessionSuffix: string } {
  const markerIndex = userId.indexOf(SESSION_MARKER);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const splitAt = markerIndex + SESSION_MARKER.length;
  return {
    prefix: userId.slice(0, splitAt),
    sessionSuffix: userId.slice(splitAt),
  };
}

describe("provider-testing cc preset session metadata", () => {
  test("cc 预置请求会替换 metadata.user_id 的 session 后缀", () => {
    const ccPresetIds = ["cc_base", "cc_sonnet", "public_cc_base"] as const;

    for (const presetId of ccPresetIds) {
      const preset = getPreset(presetId);
      expect(preset).toBeDefined();

      const originalUserId = (preset?.payload.metadata as { user_id?: string })?.user_id;
      expect(typeof originalUserId).toBe("string");
      if (typeof originalUserId !== "string") continue;

      const rotatedPayload = getPresetPayload(presetId);
      const rotatedUserId = (rotatedPayload.metadata as { user_id?: string })?.user_id;

      expect(typeof rotatedUserId).toBe("string");
      if (typeof rotatedUserId !== "string") continue;

      const original = splitSessionUserId(originalUserId);
      const rotated = splitSessionUserId(rotatedUserId);

      expect(rotated.prefix).toBe(original.prefix);
      expect(rotated.sessionSuffix).toMatch(UUID_V4_PATTERN);
      expect(rotatedUserId).not.toBe(originalUserId);
    }
  });

  test("每次获取 cc 预置请求都生成新的 session UUID", () => {
    const firstUserId = (getPresetPayload("cc_base").metadata as { user_id?: string })?.user_id;
    const secondUserId = (getPresetPayload("cc_base").metadata as { user_id?: string })?.user_id;

    expect(typeof firstUserId).toBe("string");
    expect(typeof secondUserId).toBe("string");
    if (typeof firstUserId !== "string" || typeof secondUserId !== "string") return;

    expect(firstUserId).not.toBe(secondUserId);
  });

  test("非 cc 预置请求保持原样，不注入 metadata.user_id", () => {
    const payload = getPresetPayload("cx_base");
    expect(payload).not.toHaveProperty("metadata");
  });

  test("cx 预置请求会把 prompt_cache_key 替换为 UUID v7", () => {
    const firstPayload = getPresetPayload("cx_base");
    const secondPayload = getPresetPayload("cx_base");

    const firstPromptCacheKey = firstPayload.prompt_cache_key;
    const secondPromptCacheKey = secondPayload.prompt_cache_key;

    expect(typeof firstPromptCacheKey).toBe("string");
    expect(typeof secondPromptCacheKey).toBe("string");
    if (typeof firstPromptCacheKey !== "string" || typeof secondPromptCacheKey !== "string") {
      return;
    }

    expect(firstPromptCacheKey).toMatch(UUID_V7_PATTERN);
    expect(secondPromptCacheKey).toMatch(UUID_V7_PATTERN);
    expect(firstPromptCacheKey).not.toBe(secondPromptCacheKey);
  });
});
