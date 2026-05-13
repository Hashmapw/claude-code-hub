/**
 * 从请求头中提取 API Key。
 *
 * 支持多种认证方式：
 * - Authorization: Bearer <key>
 * - x-api-key: <key>
 * - x-goog-api-key: <key>（Gemini）
 */
export function extractApiKeyFromHeaders(headers: {
  authorization?: string | null;
  "x-api-key"?: string | null;
  "x-goog-api-key"?: string | null;
}): string | null {
  const authHeader = headers.authorization?.trim();
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  const apiKey = headers["x-api-key"]?.trim();
  if (apiKey) {
    return apiKey;
  }

  const geminiKey = headers["x-goog-api-key"]?.trim();
  if (geminiKey) {
    return geminiKey;
  }

  return null;
}
