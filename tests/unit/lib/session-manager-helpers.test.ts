import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const loggerWarnMock = vi.fn();
const PARSE_HEADER_RECORD_WARN_MESSAGE = "SessionManager: Failed to parse header record JSON";

function getParseHeaderRecordWarnCalls(): unknown[][] {
  return loggerWarnMock.mock.calls.filter((call) => call[0] === PARSE_HEADER_RECORD_WARN_MESSAGE);
}

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: loggerWarnMock,
    trace: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const sanitizeHeadersMock = vi.fn();

vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  sanitizeHeaders: sanitizeHeadersMock,
  sanitizeUrl: vi.fn((value: string) => value),
}));

vi.mock("@/app/v1/_lib/codex/session-extractor", () => ({
  extractCodexSessionId: vi.fn(() => ({ sessionId: null, source: null })),
}));

vi.mock("@/lib/claude-code/metadata-user-id", () => ({
  parseClaudeMetadataUserId: vi.fn((value: unknown) => {
    if (typeof value !== "string") {
      return { sessionId: null, format: null };
    }

    try {
      const parsed = JSON.parse(value) as { session_id?: unknown };
      if (typeof parsed?.session_id === "string" && parsed.session_id.length > 0) {
        return { sessionId: parsed.session_id, format: "json" };
      }
    } catch {}

    const legacyMatch = value.match(/_account__session_(.+)$/);
    return {
      sessionId: legacyMatch?.[1] ?? null,
      format: legacyMatch ? "legacy" : null,
    };
  }),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: vi.fn(() => ({ STORE_SESSION_MESSAGES: false })),
}));

vi.mock("@/lib/utils/message-redaction", () => ({
  redactMessages: vi.fn((value: unknown) => value),
  redactRequestBody: vi.fn((value: unknown) => value),
  redactResponseBody: vi.fn((value: unknown) => value),
}));

vi.mock("@/lib/utils/request-sequence", () => ({
  normalizeRequestSequence: vi.fn((value: unknown) => value),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: vi.fn(() => null),
}));

vi.mock("@/lib/redis/active-session-keys", () => ({
  getGlobalActiveSessionsKey: vi.fn(() => "global"),
  getKeyActiveSessionsKey: vi.fn((keyId: number) => `key:${keyId}`),
  getUserActiveSessionsKey: vi.fn((userId: number) => `user:${userId}`),
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: class MockSessionTracker {},
}));

describe("SessionManager 辅助函数", () => {
  let headersToSanitizedObject: typeof import("@/lib/session-manager").headersToSanitizedObject;
  let parseHeaderRecord: typeof import("@/lib/session-manager").parseHeaderRecord;
  let extractClientSessionId: typeof import("@/lib/session-manager").SessionManager.extractClientSessionId;

  beforeAll(async () => {
    const mod = await import("@/lib/session-manager");
    headersToSanitizedObject = mod.headersToSanitizedObject;
    parseHeaderRecord = mod.parseHeaderRecord;
    extractClientSessionId = mod.SessionManager.extractClientSessionId;
  }, 20_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("parseHeaderRecord：有效 JSON 对象应解析为记录", async () => {
    expect(parseHeaderRecord('{"a":"1","b":"2"}')).toEqual({ a: "1", b: "2" });
    expect(getParseHeaderRecordWarnCalls()).toHaveLength(0);
  });

  test("parseHeaderRecord：空对象应返回空记录", async () => {
    expect(parseHeaderRecord("{}")).toEqual({});
    expect(getParseHeaderRecordWarnCalls()).toHaveLength(0);
  });

  test("parseHeaderRecord：只保留字符串值", async () => {
    expect(parseHeaderRecord('{"a":"1","b":2,"c":true,"d":null,"e":{},"f":[]}')).toEqual({
      a: "1",
    });
    expect(getParseHeaderRecordWarnCalls()).toHaveLength(0);
  });

  test("parseHeaderRecord：无效 JSON 应返回 null 并记录 warn", async () => {
    expect(parseHeaderRecord("{bad json")).toBe(null);
    const calls = getParseHeaderRecordWarnCalls();
    expect(calls).toHaveLength(1);

    const [message, meta] = calls[0] ?? [];
    expect(message).toBe("SessionManager: Failed to parse header record JSON");
    expect(meta).toEqual(expect.objectContaining({ error: expect.anything() }));
  });

  test("parseHeaderRecord：JSON 数组/null/原始值应返回 null", async () => {
    expect(parseHeaderRecord('["a"]')).toBe(null);
    expect(parseHeaderRecord("null")).toBe(null);
    expect(parseHeaderRecord("1")).toBe(null);
    expect(getParseHeaderRecordWarnCalls()).toHaveLength(0);
  });

  test("headersToSanitizedObject：单个 header 应正确转换", async () => {
    const headers = new Headers({ "x-test": "1" });
    sanitizeHeadersMock.mockReturnValueOnce("x-test: 1");

    expect(headersToSanitizedObject(headers)).toEqual({ "x-test": "1" });
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });

  test("headersToSanitizedObject：多个 header 应正确转换", async () => {
    const headers = new Headers({ a: "1", b: "2" });
    sanitizeHeadersMock.mockReturnValueOnce("a: 1\nb: 2");

    expect(headersToSanitizedObject(headers)).toEqual({ a: "1", b: "2" });
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });

  test("headersToSanitizedObject：空 Headers 应返回空对象", async () => {
    const headers = new Headers();
    sanitizeHeadersMock.mockReturnValueOnce("(empty)");

    expect(headersToSanitizedObject(headers)).toEqual({});
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });

  test("headersToSanitizedObject：值包含冒号时应保留完整值", async () => {
    const headers = new Headers({ "x-test": "a:b:c" });
    sanitizeHeadersMock.mockReturnValueOnce("x-test: a:b:c");

    expect(headersToSanitizedObject(headers)).toEqual({ "x-test": "a:b:c" });
    expect(sanitizeHeadersMock).toHaveBeenCalledWith(headers);
  });

  test("extractClientSessionId：应兼容旧格式 metadata.user_id", async () => {
    expect(
      extractClientSessionId({
        metadata: {
          user_id:
            "user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_account__session_sess_legacy_123",
        },
      })
    ).toBe("sess_legacy_123");
  });

  test("extractClientSessionId：应兼容 JSON 字符串 metadata.user_id", async () => {
    expect(
      extractClientSessionId({
        metadata: {
          user_id: JSON.stringify({
            device_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            account_uuid: "",
            session_id: "sess_json_123",
          }),
        },
      })
    ).toBe("sess_json_123");
  });

  test("extractClientSessionId：无效 user_id 时应回退到 metadata.session_id", async () => {
    expect(
      extractClientSessionId({
        metadata: {
          user_id: "invalid_user_id",
          session_id: "sess_fallback_123",
        },
      })
    ).toBe("sess_fallback_123");
  });
});
