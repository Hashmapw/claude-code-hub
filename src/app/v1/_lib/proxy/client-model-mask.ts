/**
 * 客户端模型名遮蔽（隐藏模型重定向）
 *
 * 背景：当供应商配置了 modelRedirects（例如客户端请求 "claude-sonnet-4-5"，
 * 内部重定向为上游真实模型 "glm-4.6"）时，上游响应体里的 model 字段会是重定向后的
 * 真实模型名，从而把重定向"泄漏"给客户端。
 *
 * 本模块只负责改写「发回客户端」那一份响应体里的 model 字段，使客户端始终看到自己请求的模型名。
 *
 * 关键约束：
 * - 只改写已知的结构化 model 字段（model / message.model / response.model / modelVersion /
 *   model_version），绝不对响应内容做裸字符串替换，避免把正文里出现的模型名误改。
 * - 只在内部统计/计费分支（internalStream / responseForLog 克隆）之外的「客户端分支」上调用，
 *   因此 actualResponseModel 等审计字段仍然记录上游真实模型，使用记录依旧能正确显示不一致。
 *
 * 见 response-handler.ts 中 ProxyResponseHandler.dispatch 的接入点。
 */

/**
 * 就地改写对象上已知位置的 model 字段。
 *
 * 仅当字段当前为字符串时才覆盖（不会给原本没有该字段的对象注入新字段）。
 *
 * @returns 是否实际发生了改写
 */
export function rewriteModelFieldsInPlace(value: unknown, maskedModel: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  let changed = false;

  // Claude Messages（非流式）/ OpenAI Chat chunk & completion / OpenAI Responses（非流式）顶层
  if (typeof obj.model === "string") {
    obj.model = maskedModel;
    changed = true;
  }

  // Claude Messages 流式：message_start 事件里的 message.model
  const message = obj.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const messageObj = message as Record<string, unknown>;
    if (typeof messageObj.model === "string") {
      messageObj.model = maskedModel;
      changed = true;
    }
  }

  // OpenAI Responses 流式：response.created / response.completed 等事件里的 response.model
  const response = obj.response;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const responseObj = response as Record<string, unknown>;
    if (typeof responseObj.model === "string") {
      responseObj.model = maskedModel;
      changed = true;
    }
  }

  // Gemini：modelVersion / model_version
  if (typeof obj.modelVersion === "string") {
    obj.modelVersion = maskedModel;
    changed = true;
  }
  if (typeof obj.model_version === "string") {
    obj.model_version = maskedModel;
    changed = true;
  }

  return changed;
}

/**
 * 廉价预检：响应片段里根本不含 model 字段名时，跳过 JSON 解析。
 * 大多数流式增量（content delta）都不含 model，借此把热路径开销降到最低。
 */
function mayContainModelField(text: string): boolean {
  return (
    text.includes('"model"') || text.includes('"modelVersion"') || text.includes('"model_version"')
  );
}

/**
 * 改写一段 JSON 文本里的 model 字段（用于非流式响应体）。
 *
 * 解析失败或没有可改写字段时，原样返回输入文本（不破坏非 JSON / 二进制内容）。
 */
export function maskModelInJsonText(text: string, maskedModel: string): string {
  if (!mayContainModelField(text)) {
    return text;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (rewriteModelFieldsInPlace(parsed, maskedModel)) {
      return JSON.stringify(parsed);
    }
  } catch {
    // 非 JSON：原样返回
  }
  return text;
}

/**
 * 改写单行 SSE 文本。仅处理 `data:` 行里的 JSON，其它行（event:/id:/注释/空行）原样返回。
 */
function maskModelInSseLine(line: string, maskedModel: string): string {
  if (!line.startsWith("data:")) {
    return line;
  }
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]" || !mayContainModelField(payload)) {
    return line;
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (rewriteModelFieldsInPlace(parsed, maskedModel)) {
      return `data: ${JSON.stringify(parsed)}`;
    }
  } catch {
    // data 行不是合法 JSON：原样返回
  }
  return line;
}

/**
 * 构造一个按行缓冲的 SSE 改写 TransformStream，把流式响应体里的 model 字段改写为 maskedModel。
 *
 * 仅改写 `data:` 行里的结构化 model 字段，保持 SSE 事件分帧（event:/空行/换行）不变。
 * 只应接在「客户端分支」上（tee 之后），不影响内部统计读取的上游真实内容。
 */
export function createClientModelMaskTransform(
  maskedModel: string
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      // 最后一段可能是不完整的行，留在 buffer 里等待后续数据
      buffer = lines.pop() ?? "";
      if (lines.length === 0) {
        return;
      }
      const out = `${lines.map((line) => maskModelInSseLine(line, maskedModel)).join("\n")}\n`;
      controller.enqueue(encoder.encode(out));
    },
    flush(controller) {
      const tail = buffer + decoder.decode();
      buffer = "";
      if (tail) {
        controller.enqueue(encoder.encode(maskModelInSseLine(tail, maskedModel)));
      }
    },
  });
}
