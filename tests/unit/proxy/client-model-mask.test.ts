import { describe, expect, it } from "vitest";
import {
  createClientModelMaskTransform,
  maskModelInJsonText,
  rewriteModelFieldsInPlace,
} from "@/app/v1/_lib/proxy/client-model-mask";

const MASK = "claude-sonnet-4-5-20250929";

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

async function maskStream(chunks: string[]): Promise<string> {
  return readTextStream(textStream(chunks).pipeThrough(createClientModelMaskTransform(MASK)));
}

describe("rewriteModelFieldsInPlace", () => {
  it("rewrites top-level model (OpenAI chunk / Claude non-stream)", () => {
    const obj: Record<string, unknown> = { id: "x", model: "glm-4.6", choices: [] };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(true);
    expect(obj.model).toBe(MASK);
  });

  it("rewrites message.model (Claude message_start)", () => {
    const obj = { type: "message_start", message: { id: "m", model: "glm-4.6", usage: {} } };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(true);
    expect(obj.message.model).toBe(MASK);
  });

  it("rewrites response.model (OpenAI Responses event)", () => {
    const obj = { type: "response.created", response: { id: "r", model: "glm-4.6" } };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(true);
    expect(obj.response.model).toBe(MASK);
  });

  it("rewrites gemini modelVersion and model_version", () => {
    const obj: Record<string, unknown> = { modelVersion: "gemini-x", model_version: "gemini-y" };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(true);
    expect(obj.modelVersion).toBe(MASK);
    expect(obj.model_version).toBe(MASK);
  });

  it("rewrites every known position at once", () => {
    const obj = {
      model: "a",
      message: { model: "b" },
      response: { model: "c" },
      modelVersion: "d",
    };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(true);
    expect(obj.model).toBe(MASK);
    expect(obj.message.model).toBe(MASK);
    expect(obj.response.model).toBe(MASK);
    expect(obj.modelVersion).toBe(MASK);
  });

  it("does NOT inject model into objects that lack it", () => {
    const obj: Record<string, unknown> = { type: "content_block_delta", delta: { text: "hi" } };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(false);
    expect("model" in obj).toBe(false);
  });

  it("ignores non-string model fields", () => {
    const obj: Record<string, unknown> = { model: 123 };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(false);
    expect(obj.model).toBe(123);
  });

  it("is a no-op when the model already equals the masked model (returns false)", () => {
    const obj: Record<string, unknown> = { id: "x", model: MASK, message: { model: MASK } };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(false);
  });

  it("returns false for non-objects / arrays / null", () => {
    expect(rewriteModelFieldsInPlace(null, MASK)).toBe(false);
    expect(rewriteModelFieldsInPlace("str", MASK)).toBe(false);
    expect(rewriteModelFieldsInPlace([{ model: "a" }], MASK)).toBe(false);
  });

  it("does not touch a model-like string inside content text", () => {
    const obj = { delta: { type: "text_delta", text: "the model is glm-4.6" } };
    expect(rewriteModelFieldsInPlace(obj, MASK)).toBe(false);
    expect(obj.delta.text).toBe("the model is glm-4.6");
  });
});

describe("maskModelInJsonText", () => {
  it("rewrites model in a non-stream JSON body", () => {
    const input = JSON.stringify({ id: "x", model: "glm-4.6", choices: [] });
    const out = JSON.parse(maskModelInJsonText(input, MASK));
    expect(out.model).toBe(MASK);
  });

  it("returns input unchanged when there is no model field (skips parse via pre-check)", () => {
    const input = JSON.stringify({ id: "x", choices: [] });
    expect(maskModelInJsonText(input, MASK)).toBe(input);
  });

  it("returns input unchanged for non-JSON text", () => {
    const input = 'not json but mentions "model" somewhere';
    expect(maskModelInJsonText(input, MASK)).toBe(input);
  });

  it("rewrites nested gemini modelVersion", () => {
    const input = JSON.stringify({ candidates: [], modelVersion: "gemini-2.5-pro" });
    const out = JSON.parse(maskModelInJsonText(input, MASK));
    expect(out.modelVersion).toBe(MASK);
  });

  it("returns input unchanged when the model already equals the masked model", () => {
    const input = JSON.stringify({ id: "x", model: MASK, choices: [] });
    expect(maskModelInJsonText(input, MASK)).toBe(input);
  });
});

describe("createClientModelMaskTransform", () => {
  it("masks Claude message_start model in an SSE stream", async () => {
    const sse =
      "event: message_start\n" +
      `data: ${JSON.stringify({ type: "message_start", message: { id: "m", model: "glm-4.6", usage: { input_tokens: 1 } } })}\n` +
      "\n";
    const out = await maskStream([sse]);
    expect(out).toContain("event: message_start");
    expect(out).toContain(MASK);
    expect(out).not.toContain("glm-4.6");
    // framing preserved
    expect(out).toContain("\n\n");
  });

  it("masks model in every OpenAI chat chunk", async () => {
    const chunk = (i: number) =>
      `data: ${JSON.stringify({ id: "c", model: "glm-4.6", choices: [{ delta: { content: String(i) } }] })}\n\n`;
    const out = await maskStream([chunk(1), chunk(2), "data: [DONE]\n\n"]);
    expect(out).not.toContain("glm-4.6");
    expect((out.match(new RegExp(MASK, "g")) ?? []).length).toBe(2);
    expect(out).toContain("data: [DONE]");
  });

  it("masks OpenAI Responses response.model events", async () => {
    const sse = `data: ${JSON.stringify({ type: "response.created", response: { id: "r", model: "glm-4.6" } })}\n\n`;
    const out = await maskStream([sse]);
    expect(out).toContain(MASK);
    expect(out).not.toContain("glm-4.6");
  });

  it("handles an event split across multiple chunks", async () => {
    const full = `data: ${JSON.stringify({ id: "c", model: "glm-4.6", choices: [] })}\n\n`;
    const mid = Math.floor(full.length / 2);
    const out = await maskStream([full.slice(0, mid), full.slice(mid)]);
    expect(out).toContain(MASK);
    expect(out).not.toContain("glm-4.6");
  });

  it("leaves content deltas and non-data lines untouched", async () => {
    const sse =
      "event: content_block_delta\n" +
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "talking about glm-4.6" } })}\n` +
      "\n";
    const out = await maskStream([sse]);
    // The text mentioning a model name must be preserved verbatim
    expect(out).toContain("talking about glm-4.6");
    expect(out).toContain("event: content_block_delta");
  });

  it("passes through a stream with no model fields unchanged", async () => {
    const sse = 'event: ping\ndata: {"type":"ping"}\n\n';
    const out = await maskStream([sse]);
    expect(out).toBe(sse);
  });

  it("masks a trailing event with no final newline (flush path)", async () => {
    const sse = `data: ${JSON.stringify({ id: "c", model: "glm-4.6", choices: [] })}`;
    const out = await maskStream([sse]);
    expect(out).toContain(MASK);
    expect(out).not.toContain("glm-4.6");
  });

  it("passes a chunk through verbatim when its model already equals the masked model", async () => {
    const sse = `data: ${JSON.stringify({ id: "c", model: MASK, choices: [] })}\n\n`;
    const out = await maskStream([sse]);
    expect(out).toBe(sse);
  });
});
