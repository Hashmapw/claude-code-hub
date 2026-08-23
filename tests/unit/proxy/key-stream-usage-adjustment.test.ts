import { describe, expect, it } from "vitest";
import {
  adjustUsageLikeObjectInPlace,
  applyKeyStreamUsageAdjustmentToStream,
  shouldApplyKeyStreamUsageAdjustment,
  type KeyStreamUsageAdjustmentDecision,
} from "@/app/v1/_lib/proxy/key-stream-usage-adjustment";
import {
  normalizeStreamUsageAdjustmentConfig,
  type StreamUsageAdjustmentConfig,
} from "@/lib/key-stream-usage-adjustment-config";

const BASE_CONFIG: StreamUsageAdjustmentConfig = {
  enabled: true,
  probability: 100,
  inputTokensRatio: 50,
  outputTokensRatio: 200,
  cacheReadInputTokensRatio: 10,
  cacheCreationInputTokensRatio: 300,
};

function makeDecision(hit = true): KeyStreamUsageAdjustmentDecision {
  return {
    config: BASE_CONFIG,
    hit,
    audit: {
      type: "key_stream_usage_adjustment",
      scope: "response",
      hit,
      keyId: 1,
      probability: BASE_CONFIG.probability,
      ratios: {
        inputTokens: BASE_CONFIG.inputTokensRatio,
        outputTokens: BASE_CONFIG.outputTokensRatio,
        cacheReadInputTokens: BASE_CONFIG.cacheReadInputTokensRatio,
        cacheCreationInputTokens: BASE_CONFIG.cacheCreationInputTokensRatio,
      },
    },
  };
}

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readTextStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("key stream usage adjustment", () => {
  it("normalizes partial persisted configs and clamps unsafe values", () => {
    expect(normalizeStreamUsageAdjustmentConfig(null)).toBeNull();
    expect(
      normalizeStreamUsageAdjustmentConfig({
        enabled: true,
        probability: "125",
        inputTokensRatio: -10,
        outputTokensRatio: "250",
      })
    ).toEqual({
      enabled: true,
      probability: 100,
      inputTokensRatio: 0,
      outputTokensRatio: 250,
      cacheReadInputTokensRatio: 100,
      cacheCreationInputTokensRatio: 100,
    });
  });

  it("samples once per request using a stable probability bucket", () => {
    expect(shouldApplyKeyStreamUsageAdjustment({ ...BASE_CONFIG, enabled: false }, "seed")).toBe(
      false
    );
    expect(shouldApplyKeyStreamUsageAdjustment({ ...BASE_CONFIG, probability: 0 }, "seed")).toBe(
      false
    );
    expect(shouldApplyKeyStreamUsageAdjustment({ ...BASE_CONFIG, probability: 100 }, "seed")).toBe(
      true
    );

    const config = { ...BASE_CONFIG, probability: 37.5 };
    expect(shouldApplyKeyStreamUsageAdjustment(config, "request-seed")).toBe(
      shouldApplyKeyStreamUsageAdjustment(config, "request-seed")
    );
  });

  it("rewrites Anthropic usage and Claude cache creation buckets", () => {
    const payload = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
        cache_creation: {
          ephemeral_5m_input_tokens: 60,
          ephemeral_1h_input_tokens: 40,
        },
      },
    };

    expect(adjustUsageLikeObjectInPlace(payload, BASE_CONFIG)).toBe(true);
    expect(payload.usage).toMatchObject({
      input_tokens: 500,
      output_tokens: 1000,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 300,
      cache_creation: {
        ephemeral_5m_input_tokens: 180,
        ephemeral_1h_input_tokens: 120,
      },
    });
  });

  it("rewrites OpenAI Chat cached subsets and recalculates totals", () => {
    const payload = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        prompt_tokens_details: { cached_tokens: 200 },
      },
    };

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(payload.usage).toEqual({
      prompt_tokens: 420,
      completion_tokens: 1000,
      total_tokens: 1420,
      prompt_tokens_details: { cached_tokens: 20 },
    });
  });

  it("rewrites OpenAI Responses cached subsets and recalculates totals", () => {
    const payload = {
      response: {
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          total_tokens: 1500,
          input_tokens_details: { cached_tokens: 200 },
        },
      },
    };

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(payload.response.usage).toEqual({
      input_tokens: 420,
      output_tokens: 1000,
      total_tokens: 1420,
      input_tokens_details: { cached_tokens: 20 },
    });
  });

  it("rewrites Gemini cached input semantics and totals", () => {
    const payload = {
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 500,
        cachedContentTokenCount: 200,
        totalTokenCount: 1700,
      },
    };

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(payload.usageMetadata).toEqual({
      promptTokenCount: 520,
      candidatesTokenCount: 1000,
      cachedContentTokenCount: 20,
      totalTokenCount: 1520,
    });
  });

  it("recalculates Gemini totals when all adjusted token counts are zero", () => {
    const payload = {
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };

    adjustUsageLikeObjectInPlace(payload, {
      ...BASE_CONFIG,
      inputTokensRatio: 0,
      outputTokensRatio: 0,
    });

    expect(payload.usageMetadata).toEqual({
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
    });
  });

  it("handles direct cached-input subsets in Gemini streams converted to OpenAI", () => {
    const payload = {
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 500,
        total_tokens: 1700,
        cache_read_input_tokens: 200,
      },
    };

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG, {
      directCacheReadIsInputSubset: true,
    });

    expect(payload.usage).toEqual({
      prompt_tokens: 520,
      completion_tokens: 1000,
      total_tokens: 1520,
      cache_read_input_tokens: 20,
    });
  });

  it("handles JSON split across chunks while preserving SSE framing", async () => {
    const payload = JSON.stringify({
      usage: { input_tokens: 1000, output_tokens: 500 },
    });
    const input = `data: ${payload}\n\ndata: [DONE]\n\n`;
    const splitAt = Math.floor(input.length / 2);

    const output = await readTextStream(
      applyKeyStreamUsageAdjustmentToStream(
        textStream([input.slice(0, splitAt), input.slice(splitAt)]),
        makeDecision()
      )
    );

    expect(output).toContain('"input_tokens":500');
    expect(output).toContain('"output_tokens":1000');
    expect(output).toContain("data: [DONE]\n\n");
  });

  it("rewrites NDJSON and fails open for malformed or non-JSON lines", async () => {
    const gemini = JSON.stringify({
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 500,
        cachedContentTokenCount: 200,
        totalTokenCount: 1700,
      },
    });
    const input = `{bad-json}\nplain-text\n${gemini}\n`;

    const output = await readTextStream(
      applyKeyStreamUsageAdjustmentToStream(textStream([input]), makeDecision())
    );

    const lines = output.trimEnd().split("\n");
    expect(lines[0]).toBe("{bad-json}");
    expect(lines[1]).toBe("plain-text");
    expect(JSON.parse(lines[2]).usageMetadata).toEqual({
      promptTokenCount: 520,
      candidatesTokenCount: 1000,
      cachedContentTokenCount: 20,
      totalTokenCount: 1520,
    });
  });

  it("passes the stream through unchanged when request sampling misses", async () => {
    const input = 'data: {"usage":{"input_tokens":1000,"output_tokens":500}}\n\n';

    const output = await readTextStream(
      applyKeyStreamUsageAdjustmentToStream(textStream([input]), makeDecision(false))
    );

    expect(output).toBe(input);
  });
});
