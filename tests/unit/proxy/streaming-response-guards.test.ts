import { describe, expect, test } from "vitest";
import {
  hasExplicitZeroUsage,
  responseTextHasExplicitZeroUsage,
  shouldRejectStreamingContentLength,
} from "@/app/v1/_lib/proxy/streaming-response-guards";

describe("streaming response guards", () => {
  test("detects Content-Length only when provider switch is enabled", () => {
    const headers = new Headers({ "content-length": "42", "content-type": "text/event-stream" });

    expect(
      shouldRejectStreamingContentLength({ rejectStreamingContentLength: true }, headers)
    ).toBe(true);
    expect(
      shouldRejectStreamingContentLength({ rejectStreamingContentLength: false }, headers)
    ).toBe(false);
  });

  test("detects explicit zero usage objects", () => {
    expect(hasExplicitZeroUsage({ input_tokens: 0, output_tokens: 0 })).toBe(true);
    expect(hasExplicitZeroUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })).toBe(
      true
    );
    expect(hasExplicitZeroUsage({ input_tokens: 0 })).toBe(false);
    expect(hasExplicitZeroUsage({ input_tokens: 0, output_tokens: 1 })).toBe(false);
  });

  test("detects zero usage split across SSE events", () => {
    const sseText = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":0}}}',
      "",
      'data: {"type":"message_delta","usage":{"output_tokens":0}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");

    expect(responseTextHasExplicitZeroUsage(sseText)).toBe(true);
  });

  test("does not reject streams with missing usage or any positive billable usage", () => {
    const missingUsage = 'data: {"type":"content_block_delta","delta":{"text":"pong"}}\n\n';
    const positiveAfterInitialZero = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}',
      "",
      'data: {"type":"message_delta","usage":{"output_tokens":3}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");

    expect(responseTextHasExplicitZeroUsage(missingUsage)).toBe(false);
    expect(responseTextHasExplicitZeroUsage(positiveAfterInitialZero)).toBe(false);
  });

  test("detects zero usage in Responses API completed payload", () => {
    const sseText = [
      "event: response.completed",
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}',
      "",
    ].join("\n");

    expect(responseTextHasExplicitZeroUsage(sseText)).toBe(true);
  });
});
