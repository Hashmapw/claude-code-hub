# Key 流式 Usage Token 改写说明

本文档说明 Key 级别的流式 usage token 改写能力，包括配置、权限、命中规则、协议范围和计费口径。

## 功能目标

管理员可以在“编辑密钥”中为单个 Key 配置：

- 是否启用流式 usage token 改写。
- 每次请求的命中概率。
- 输入、输出、缓存读取、缓存创建四类 token 的独立倍率。

命中后，同一次请求中的四类 token 会按各自倍率改写。未命中或关闭时，客户端收到上游原值。

该功能只在编辑已有 Key 时配置，不在创建用户或创建 Key 的流程中提供入口。

## 配置结构

配置保存在 `keys.stream_usage_adjustment` JSONB 字段中：

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

| 字段 | 默认值 | 范围 |
| --- | ---: | ---: |
| `enabled` | `false` | `true` / `false` |
| `probability` | `100` | `0..100` |
| `inputTokensRatio` | `100` | `0..10000` |
| `outputTokensRatio` | `100` | `0..10000` |
| `cacheReadInputTokensRatio` | `100` | `0..10000` |
| `cacheCreationInputTokensRatio` | `100` | `0..10000` |

倍率以百分比表示。`100` 表示不变，`50` 表示减半，`200` 表示翻倍，`0` 表示改写为零。计算规则为：

```text
rewritten = Math.round(original * ratio / 100)
```

## 命中规则

采样按请求进行，不会为每个 chunk 或 usage 字段重复采样：

1. `enabled=false` 时不改写。
2. `probability<=0` 时不命中。
3. `probability>=100` 时必定命中。
4. 其它概率使用 Key、message、session 和 request sequence 组成稳定 seed。

同一次请求要么全部不改写，要么四类 token 同时按各自倍率改写。

## 协议范围

该能力只处理流式响应中的 usage-like JSON 字段：

- Anthropic SSE：`input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`。
- OpenAI Chat SSE：`prompt_tokens`、`completion_tokens`、`prompt_tokens_details.cached_tokens`。
- OpenAI Responses SSE：`input_tokens`、`output_tokens`、`input_tokens_details.cached_tokens`。
- Gemini NDJSON：`usageMetadata.promptTokenCount`、`candidatesTokenCount`、`cachedContentTokenCount`。

OpenAI 的 cached token 是输入 token 的子集。实现会分别改写非缓存输入和缓存输入，再重算输入与总 token，避免重复计算。

Gemini 客户端访问 Gemini 供应商时，未命中继续使用原生快速透传；命中后进入通用流处理器，但仍输出 Gemini NDJSON，不经过 OpenAI 格式转换。

非 JSON 行、`data: [DONE]` 和解析失败的 JSON 会 fail-open，保持原文本不变。

## 权限边界

该配置是管理员专用能力：

- 管理员可以在编辑 Key 时保存配置。
- 普通用户即使伪造六个 `streamUsageAdjustment*` 字段，服务端也会静默忽略。
- 写库成功后会失效该 API Key 的鉴权缓存，下一次代理请求读取新配置。

## 客户端、计费和记录口径

| 场景 | 使用值 |
| --- | --- |
| 客户端流式响应 | 命中时为改写值，否则为上游原值 |
| 计费、配额和限流 | 命中时为改写值，否则为上游原值 |
| 请求使用记录和 usage ledger | 命中时为改写值，否则为上游原值 |

例如上游返回 `input_tokens=1000`、`output_tokens=500`，输入倍率为 `50`、输出倍率为 `200`：

- 客户端、计费、限流、请求记录和 usage ledger 均使用
  `input_tokens=500`、`output_tokens=1000`。

改写后的客户端流进入统计、计费和 replay spool。终态持久化复用同一份改写后 usage，避免客户端返回值、费用、配额结算、请求记录和 usage ledger 之间出现口径差异。

## 保存与回显

编辑表单提交六个字段：

- `streamUsageAdjustmentEnabled`
- `streamUsageAdjustmentProbability`
- `streamUsageAdjustmentInputTokensRatio`
- `streamUsageAdjustmentOutputTokensRatio`
- `streamUsageAdjustmentCacheReadInputTokensRatio`
- `streamUsageAdjustmentCacheCreationInputTokensRatio`

服务端通过 `KeyFormSchema` 校验范围并写入单个 JSONB 配置。用户列表返回时再展平为上述六个字段，以便重新打开编辑框时回显。

## 数据库检查

```sql
select id, name, stream_usage_adjustment
from keys
where id = <key_id>;
```

- `null`：尚未保存配置，或保存者不是管理员。
- `enabled=false`：配置存在但关闭。
- 所有倍率为 `100`：功能命中时 token 数值仍不变。

数据库迁移文件为 `drizzle/0122_wide_phalanx.sql`。

## 相关代码

- `src/lib/key-stream-usage-adjustment-config.ts`
- `src/app/v1/_lib/proxy/key-stream-usage-adjustment.ts`
- `src/app/v1/_lib/proxy/response-handler.ts`
- `src/actions/keys.ts`
- `src/actions/users.ts`
- `src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/stream-usage-adjustment-fields.tsx`

主要回归测试：

- `tests/unit/proxy/key-stream-usage-adjustment.test.ts`
- `tests/unit/proxy/response-handler-lease-decrement.test.ts`
- `tests/unit/proxy/response-handler-stream-terminal.test.ts`
- `tests/unit/actions/keys-stream-usage-adjustment-admin-gate.test.ts`
- `tests/unit/users-action-get-users-compat.test.ts`
- `tests/unit/dashboard/edit-key-form-expiry-clear-ui.test.tsx`
