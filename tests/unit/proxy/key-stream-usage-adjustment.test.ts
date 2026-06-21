import { describe, expect, it } from "vitest";
import { parseUsageFromResponseText } from "@/app/v1/_lib/proxy/response-handler";
import {
  adjustUsageLikeObjectInPlace,
  applyKeyStreamUsageAdjustmentToStream,
  shouldApplyKeyStreamUsageAdjustment,
  type KeyStreamUsageAdjustmentDecision,
} from "@/app/v1/_lib/proxy/key-stream-usage-adjustment";
import type { StreamUsageAdjustmentConfig } from "@/lib/key-stream-usage-adjustment-config";

const BASE_CONFIG: StreamUsageAdjustmentConfig = {
  enabled: true,
  probability: 100,
  inputTokensRatio: 50,
  outputTokensRatio: 200,
  cacheReadInputTokensRatio: 10,
  cacheCreationInputTokensRatio: 300,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeDecision(
  config: StreamUsageAdjustmentConfig = BASE_CONFIG
): KeyStreamUsageAdjustmentDecision {
  return {
    config,
    hit: true,
    audit: {
      type: "key_stream_usage_adjustment",
      scope: "response",
      hit: true,
      keyId: 1,
      probability: config.probability,
      ratios: {
        inputTokens: config.inputTokensRatio,
        outputTokens: config.outputTokensRatio,
        cacheReadInputTokens: config.cacheReadInputTokensRatio,
        cacheCreationInputTokens: config.cacheCreationInputTokensRatio,
      },
    },
  };
}

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function readTextStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("key stream usage adjustment", () => {
  it("samples once per request using the configured probability", () => {
    expect(shouldApplyKeyStreamUsageAdjustment({ ...BASE_CONFIG, enabled: false }, "seed")).toBe(
      false
    );
    expect(shouldApplyKeyStreamUsageAdjustment({ ...BASE_CONFIG, probability: 0 }, "seed")).toBe(
      false
    );
    expect(shouldApplyKeyStreamUsageAdjustment({ ...BASE_CONFIG, probability: 100 }, "seed")).toBe(
      true
    );

    const first = shouldApplyKeyStreamUsageAdjustment(
      { ...BASE_CONFIG, probability: 37.5 },
      "key:message:session:1"
    );
    const second = shouldApplyKeyStreamUsageAdjustment(
      { ...BASE_CONFIG, probability: 37.5 },
      "key:message:session:1"
    );
    expect(second).toBe(first);
  });

  it("rewrites the four Anthropic usage buckets together after a hit", () => {
    const payload = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      },
    };

    const changed = adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(changed).toBe(true);
    expect(payload.usage).toEqual({
      input_tokens: 500,
      output_tokens: 1000,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 300,
    });
  });

  it("keeps Claude cache creation bucket totals consistent", () => {
    const payload = {
      type: "message_delta",
      usage: {
        output_tokens: 500,
        cache_creation_input_tokens: 100,
        cache_creation: {
          ephemeral_5m_input_tokens: 60,
          ephemeral_1h_input_tokens: 40,
        },
      },
    };

    adjustUsageLikeObjectInPlace(payload, {
      ...BASE_CONFIG,
      cacheCreationInputTokensRatio: 50,
    });

    expect(payload.usage.output_tokens).toBe(1000);
    expect(payload.usage.cache_creation).toEqual({
      ephemeral_5m_input_tokens: 30,
      ephemeral_1h_input_tokens: 20,
    });
    expect(payload.usage.cache_creation_input_tokens).toBe(50);
  });

  it("rewrites OpenAI chat cached-token subset semantics without double counting", () => {
    const payload = {
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        prompt_tokens_details: {
          cached_tokens: 200,
        },
      },
    };

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(payload.usage.prompt_tokens).toBe(420);
    expect(payload.usage.prompt_tokens_details.cached_tokens).toBe(20);
    expect(payload.usage.completion_tokens).toBe(1000);
    expect(payload.usage.total_tokens).toBe(1420);
  });

  it("rewrites OpenAI Responses cached-token subset semantics without double counting", () => {
    const payload = {
      response: {
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          total_tokens: 1500,
          input_tokens_details: {
            cached_tokens: 200,
          },
        },
      },
    };

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(payload.response.usage.input_tokens).toBe(420);
    expect(payload.response.usage.input_tokens_details.cached_tokens).toBe(20);
    expect(payload.response.usage.output_tokens).toBe(1000);
    expect(payload.response.usage.total_tokens).toBe(1420);
  });

  it("rewrites Gemini usageMetadata using non-cached input plus cache-read ratios", () => {
    const payload = {
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 500,
        cachedContentTokenCount: 200,
        totalTokenCount: 1700,
      },
    };

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(payload.usageMetadata.promptTokenCount).toBe(520);
    expect(payload.usageMetadata.cachedContentTokenCount).toBe(20);
    expect(payload.usageMetadata.candidatesTokenCount).toBe(1000);
    expect(payload.usageMetadata.totalTokenCount).toBe(1520);
  });

  it("rewrites SSE and NDJSON stream lines while leaving non-JSON and DONE lines untouched", async () => {
    const originalSsePayload = {
      type: "message_delta",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      },
    };
    const originalNdjsonPayload = {
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 500,
        cachedContentTokenCount: 200,
        totalTokenCount: 1700,
      },
    };

    const stream = textStream([
      `data: ${JSON.stringify(originalSsePayload)}\n`,
      "data: [DONE]\n",
      "not-json\n",
      `${JSON.stringify(originalNdjsonPayload)}\n`,
    ]);

    const output = await readTextStream(
      applyKeyStreamUsageAdjustmentToStream(stream, makeDecision())
    );
    const lines = output.trimEnd().split("\n");
    const ssePayload = JSON.parse(lines[0].replace(/^data:\s*/, ""));
    const ndjsonPayload = JSON.parse(lines[3]);

    expect(ssePayload.usage).toEqual({
      input_tokens: 500,
      output_tokens: 1000,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 300,
    });
    expect(lines[1]).toBe("data: [DONE]");
    expect(lines[2]).toBe("not-json");
    expect(ndjsonPayload.usageMetadata).toEqual({
      promptTokenCount: 520,
      candidatesTokenCount: 1000,
      cachedContentTokenCount: 20,
      totalTokenCount: 1520,
    });
  });

  it("does not mutate stream lines when the request-level probability misses", async () => {
    const payload = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
      },
    };
    const input = `data: ${JSON.stringify(payload)}\n`;
    const decision = makeDecision();
    decision.hit = false;

    const output = await readTextStream(
      applyKeyStreamUsageAdjustmentToStream(textStream([input]), decision)
    );

    expect(output).toBe(input);
  });

  it("lets Gemini NDJSON usage parsing see adjusted passthrough stats", () => {
    const chunks = [
      {
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          cachedContentTokenCount: 10,
          totalTokenCount: 120,
        },
      },
      {
        usageMetadata: {
          promptTokenCount: 520,
          candidatesTokenCount: 1000,
          cachedContentTokenCount: 20,
          totalTokenCount: 1520,
        },
      },
    ];
    const responseText = chunks.map((chunk) => JSON.stringify(chunk)).join("\n");

    const result = parseUsageFromResponseText(responseText, "gemini");

    expect(result.usageMetrics).toEqual({
      input_tokens: 500,
      output_tokens: 1000,
      cache_read_input_tokens: 20,
    });
  });

  it("can adjust cloned payloads without sharing mutation across test cases", () => {
    const original = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
      },
    };
    const payload = clone(original);

    adjustUsageLikeObjectInPlace(payload, BASE_CONFIG);

    expect(original.usage.input_tokens).toBe(1000);
    expect(payload.usage.input_tokens).toBe(500);
  });
});
