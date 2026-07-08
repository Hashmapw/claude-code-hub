import { describe, expect, test, vi } from "vitest";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import {
  bufferStreamingHeadForEarlyErrorGuard,
  getStreamingResponseGuardErrorType,
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

describe("streaming early-error head gate", () => {
  function makeProvider(rejectStreamingEarlyError: boolean) {
    return {
      id: 1,
      name: "p1",
      providerType: "codex" as const,
      rejectStreamingContentLength: false,
      rejectStreamingZeroUsage: false,
      rejectStreamingEarlyError,
    };
  }

  function sseResponse(chunks: string[], contentType = "text/event-stream"): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": contentType } });
  }

  const ENVELOPE_1 =
    'data: {"type":"response.created","response":{"status":"in_progress","output":[]}}\n\n';
  const ENVELOPE_2 = 'data: {"type":"response.in_progress","response":{"output":[]}}\n\n';
  const ERROR_EVENT =
    'event: error\ndata: {"type":"error","code":"request_failed","message":"request temporarily unavailable, please try again later"}\n\n';
  const CONTENT_EVENT = 'data: {"type":"response.output_item.added","item":{"type":"message"}}\n\n';

  test("returns the response unchanged when the toggle is off", async () => {
    const res = sseResponse([ENVELOPE_1, ERROR_EVENT]);
    const out = await bufferStreamingHeadForEarlyErrorGuard({
      response: res,
      provider: makeProvider(false),
    });
    expect(out).toBe(res);
  });

  test("returns unchanged for non-SSE content-type", async () => {
    const res = sseResponse(['{"type":"error"}'], "application/json");
    const out = await bufferStreamingHeadForEarlyErrorGuard({
      response: res,
      provider: makeProvider(true),
    });
    expect(out).toBe(res);
  });

  test("fails over with a 503 guard error when an error event precedes content", async () => {
    const res = sseResponse([ENVELOPE_1, ENVELOPE_2, ERROR_EVENT]);
    let caught: unknown;
    try {
      await bufferStreamingHeadForEarlyErrorGuard({ response: res, provider: makeProvider(true) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProxyError);
    expect((caught as ProxyError).statusCode).toBe(503);
    expect(getStreamingResponseGuardErrorType(caught as ProxyError)).toBe(
      "streaming_early_error_rejected"
    );
  });

  test("passes through and reconstructs the full stream once real content starts", async () => {
    const chunks = [ENVELOPE_1, CONTENT_EVENT, 'data: {"type":"response.completed"}\n\n'];
    const res = sseResponse(chunks);
    const out = await bufferStreamingHeadForEarlyErrorGuard({
      response: res,
      provider: makeProvider(true),
    });
    expect(out).not.toBe(res);
    expect(await out.text()).toBe(chunks.join(""));
  });

  test("releases the buffered response after the head budget when an envelope stalls", async () => {
    vi.useFakeTimers();
    try {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let upstreamController: ReadableStreamDefaultController<Uint8Array> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          upstreamController = controller;
          controller.enqueue(encoder.encode(ENVELOPE_1));
        },
      });
      const res = new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

      const promise = bufferStreamingHeadForEarlyErrorGuard({
        response: res,
        provider: makeProvider(true),
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2000);

      const out = await promise;
      expect(out).not.toBe(res);
      const reader = out.body?.getReader();
      expect(reader).toBeTruthy();
      const first = await reader?.read();
      expect(first?.done).toBe(false);
      expect(decoder.decode(first?.value)).toBe(ENVELOPE_1);

      upstreamController?.enqueue(encoder.encode(CONTENT_EVENT));
      upstreamController?.close();
      const second = await reader?.read();
      expect(second?.done).toBe(false);
      expect(decoder.decode(second?.value)).toBe(CONTENT_EVENT);
      const done = await reader?.read();
      expect(done?.done).toBe(true);
      await reader?.cancel("test done");
    } finally {
      vi.useRealTimers();
    }
  });
});
