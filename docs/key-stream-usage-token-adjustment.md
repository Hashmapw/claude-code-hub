# Key 流式 Usage Token 改写说明

本文档说明 Key 级别的流式 usage token 改写能力，包括配置字段、保存与回显链路、运行时命中规则、计费与使用记录口径，以及排障检查方式。

## 功能目标

部分上游服务会在流式响应中返回 usage 信息，例如 Anthropic SSE、OpenAI Chat Completions SSE、OpenAI Responses SSE、Gemini NDJSON 等。管理员有时需要对特定 Key 的客户端可见 usage token 做比例改写，用于兼容供应商差异、隔离测试或临时运营策略。

该功能允许管理员在“编辑密钥”中为单个 Key 配置：

- 是否启用流式 usage token 改写。
- 每次请求的命中概率。
- 输入 token、输出 token、缓存读取 token、缓存创建 token 四类 token 的独立倍率。

命中后，四类 token 会在同一次请求中同时按各自倍率改写；未命中或关闭时，客户端看到上游原始 usage 值。

## 适用范围

该能力只作用于流式响应中的 usage 数据：

- Anthropic/Claude 风格的 `input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`。
- OpenAI Chat Completions 风格的 `prompt_tokens`、`completion_tokens`、`prompt_tokens_details.cached_tokens`。
- OpenAI Responses 风格的 `input_tokens`、`output_tokens`、`input_tokens_details.cached_tokens`。
- Gemini 风格的 `usageMetadata.promptTokenCount`、`candidatesTokenCount`、`cachedContentTokenCount`。
- 嵌套对象中的 usage-like 字段也会递归检查和改写。

该能力不改变上游真实返回，也不会让上游重新计费；它只改写转发给客户端的流式 usage 文本，并在内部计费链路中使用命中后的改写值。

## 配置字段

配置保存在 `keys.stream_usage_adjustment` JSONB 字段中，结构如下：

```json
{
  "enabled": false,
  "probability": 100,
  "inputTokensRatio": 100,
  "outputTokensRatio": 100,
  "cacheReadInputTokensRatio": 100,
  "cacheCreationInputTokensRatio": 100
}
```

字段含义：

| 字段 | 含义 | 默认值 | 取值范围 |
| --- | --- | --- | --- |
| `enabled` | 是否启用本 Key 的流式 usage token 改写 | `false` | `true` / `false` |
| `probability` | 请求级命中概率，百分比 | `100` | `0` 到 `100` |
| `inputTokensRatio` | 输入 token 改写倍率，百分比 | `100` | `0` 到 `10000` |
| `outputTokensRatio` | 输出 token 改写倍率，百分比 | `100` | `0` 到 `10000` |
| `cacheReadInputTokensRatio` | 缓存读取 token 改写倍率，百分比 | `100` | `0` 到 `10000` |
| `cacheCreationInputTokensRatio` | 缓存创建 token 改写倍率，百分比 | `100` | `0` 到 `10000` |

倍率语义：

- `100` 表示不变。
- `50` 表示减半。
- `200` 表示翻倍。
- `0` 表示改写为 0。

改写时使用四舍五入：

```text
rewritten = Math.round(original * ratio / 100)
```

## 命中规则

该功能按请求采样，不按 token、chunk 或 usage 字段重复采样。

命中判断规则：

1. `enabled=false`：直接不改写。
2. `probability<=0`：直接不命中。
3. `probability>=100`：必定命中。
4. 其它概率：使用 Key、message、session、request sequence 组合生成稳定 seed，同一次请求只采样一次。

因此同一次请求中，只会出现两种结果：

- 未命中：四类 token 全部保持上游原始值。
- 命中：四类 token 全部按各自倍率改写。

## 改写示例

假设上游流式响应中的 usage 为：

```json
{
  "input_tokens": 1000,
  "output_tokens": 500,
  "cache_read_input_tokens": 200,
  "cache_creation_input_tokens": 100
}
```

管理员配置为：

```json
{
  "enabled": true,
  "probability": 100,
  "inputTokensRatio": 50,
  "outputTokensRatio": 200,
  "cacheReadInputTokensRatio": 100,
  "cacheCreationInputTokensRatio": 100
}
```

命中后客户端看到：

```json
{
  "input_tokens": 500,
  "output_tokens": 1000,
  "cache_read_input_tokens": 200,
  "cache_creation_input_tokens": 100
}
```

如果关闭开关，或者概率未命中，客户端仍看到上游原始值：

```json
{
  "input_tokens": 1000,
  "output_tokens": 500,
  "cache_read_input_tokens": 200,
  "cache_creation_input_tokens": 100
}
```

## 保存与回显链路

编辑密钥表单会提交以下字段：

- `streamUsageAdjustmentEnabled`
- `streamUsageAdjustmentProbability`
- `streamUsageAdjustmentInputTokensRatio`
- `streamUsageAdjustmentOutputTokensRatio`
- `streamUsageAdjustmentCacheReadInputTokensRatio`
- `streamUsageAdjustmentCacheCreationInputTokensRatio`

服务端保存时会执行：

1. 使用 `KeyFormSchema` 校验字段范围。
2. 使用 `buildStreamUsageAdjustmentConfigFromForm` 归一化配置。
3. 管理员请求才写入 `keys.stream_usage_adjustment`。
4. 写库成功后清理 API Key 鉴权缓存，避免代理热路径继续读到旧配置。
5. 刷新用户列表查询缓存，使重新打开编辑框时能看到已保存值。

用户列表和 Key 列表返回时，会把 `stream_usage_adjustment` 展平成编辑表单需要的字段。这样保存后重新打开编辑框时，不会再回到默认值。

## 权限边界

该配置是管理员专用能力。

- 管理员可以创建、编辑和保存该配置。
- 普通用户提交这些字段时，服务端会静默忽略，不会更新 `stream_usage_adjustment`。

这样可以避免普通用户自行改写 usage token，从而影响计费、配额或限流。

## 计费与使用记录口径

该功能区分三类口径：

| 场景 | 使用值 |
| --- | --- |
| 客户端流式响应 | 命中后使用改写值；未命中使用上游原始值 |
| 计费、配额和限流 | 命中后使用改写值；未命中使用上游原始值 |
| 使用记录展示 | 保存上游实际 usage 值 |

也就是说，如果上游返回：

```text
input_tokens=1000
output_tokens=500
```

配置命中后客户端看到：

```text
input_tokens=500
output_tokens=1000
```

但使用记录里仍展示上游实际值：

```text
input_tokens=1000
output_tokens=500
```

这样可以同时满足两类需求：

1. 客户端和内部计费链路按运营配置生效。
2. 管理端使用记录保留可审计的上游真实 token。

## 数据库检查

如果怀疑保存失败，可以直接查询 Key 的 JSONB 配置：

```sql
select id, name, stream_usage_adjustment
from keys
where id = <key_id>;
```

常见结果解释：

- `stream_usage_adjustment` 为 `null`：该 Key 未保存改写配置，或保存请求不是管理员发起。
- `enabled=false`：配置存在但关闭，不会改写流式 usage。
- 倍率均为 `100`：配置存在但实际不改变 token。
- 数据库有配置但运行时不生效：优先确认 API Key 鉴权缓存是否已清理，以及线上镜像是否包含保存后清缓存修复。

## 排障清单

### 保存后重新打开又变成默认值

检查顺序：

1. 当前登录用户是否为管理员。
2. 浏览器保存请求是否携带六个 `streamUsageAdjustment*` 字段。
3. 数据库 `keys.stream_usage_adjustment` 是否写入。
4. 用户列表接口返回的 Key 数据中是否包含展平后的 `streamUsageAdjustment*` 字段。
5. 前端保存成功后是否刷新 `users` 查询缓存。

### 倍率配置了但客户端看不到变化

检查顺序：

1. `enabled` 是否为 `true`。
2. `probability` 是否大于 0。
3. 倍率是否不是 `100`。
4. 当前请求是否为流式响应。
5. 上游响应中是否真的包含 usage 字段。
6. 是否命中概率采样。
7. 线上代理是否加载到最新 Key 鉴权缓存。

### 使用记录和客户端看到的 token 不一致

这是预期行为。

- 客户端看到的是改写后的 usage。
- 使用记录展示的是上游实际 usage。
- 计费、配额和限流按命中后的改写 usage 执行。

## 相关代码位置

核心代码：

- `src/lib/key-stream-usage-adjustment-config.ts`
- `src/app/v1/_lib/proxy/key-stream-usage-adjustment.ts`
- `src/app/v1/_lib/proxy/response-handler.ts`
- `src/actions/keys.ts`
- `src/actions/users.ts`
- `src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/stream-usage-adjustment-fields.tsx`

数据库：

- `src/drizzle/schema.ts`
- `drizzle/0109_ambitious_thunderbolt_ross.sql`

测试：

- `tests/unit/proxy/key-stream-usage-adjustment.test.ts`
- `tests/unit/proxy/response-handler-lease-decrement.test.ts`
- `tests/unit/actions/keys-stream-usage-adjustment-admin-gate.test.ts`
- `tests/unit/users-action-get-users-compat.test.ts`
- `tests/unit/dashboard/edit-key-form-expiry-clear-ui.test.tsx`

## 发布检查建议

提交或发布前建议至少验证：

```bash
DSN= AUTO_CLEANUP_TEST_DATA=false bunx vitest run \
  tests/unit/proxy/key-stream-usage-adjustment.test.ts \
  tests/unit/proxy/response-handler-lease-decrement.test.ts \
  tests/unit/actions/keys-stream-usage-adjustment-admin-gate.test.ts \
  tests/unit/users-action-get-users-compat.test.ts \
  tests/unit/dashboard/edit-key-form-expiry-clear-ui.test.tsx \
  --reporter=dot
```

人工验证建议：

1. 使用管理员账号打开“编辑密钥”。
2. 启用流式 usage token 改写。
3. 设置 `probability=100`，把输入 token 倍率设为 `50`，输出 token 倍率设为 `200`。
4. 保存后重新打开编辑框，确认配置仍然存在。
5. 发起一次包含流式 usage 的请求，确认客户端看到改写后的 usage。
6. 查看使用记录，确认记录中展示的是上游实际 usage。
