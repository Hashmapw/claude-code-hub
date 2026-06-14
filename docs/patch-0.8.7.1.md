# Patch 0.8.7.1 功能回补实现说明

本文档记录 `0.8.7.1` 在上游 `0.8.7` 基线上的功能回补增量。实现参考 `0.8.3` 分支以下提交的语义，并对齐 `0.7.3` 分支 `docs/sii-branding-soft-block-v0.7.3.md` 中除“流式前缀关键词拦截”以外的能力边界：

- `58db8bd693e63245b8f2fff2a40e861611876766`
- `154c98145e23a1777f19ab58ac5bc31359829577`
- `903710f2ef6c7bcbf2a35bd04f091b735d976aef`

## 1. 0.8.3 三项增量回补

### 1.1 删除 Claude stale issue workflow

当前工作树删除了：

```text
.github/workflows/claude-issue-stale-cleanup.yml
```

目的：停止仓库内由 Claude stale / triage 逻辑持续产生或处理 Oncall Issue Triage 类任务。

### 1.2 Release workflow 推回触发源分支

`/.github/workflows/release.yml` 已按 `0.8.3` 语义调整：

- release 在 branch ref 触发时，版本提交推回当前触发分支，而不是固定推到 `main`。
- tag 仍随 release 一起推送。
- `main -> dev` 同步逻辑仅在 `github.ref == 'refs/heads/main'` 时运行，避免其他分支 release 误触发 dev 同步。

关键语义：

```bash
if [[ "$GITHUB_REF" == refs/heads/* ]]; then
  TARGET_BRANCH="${GITHUB_REF#refs/heads/}"
  git push origin "HEAD:${TARGET_BRANCH}" "$NEW_TAG"
else
  git push origin "$NEW_TAG"
fi
```

### 1.3 Provider 流式响应防护

本轮回补的是 `0.8.3` 的 provider streaming response guards，不是错误规则里的流式前缀关键词拦截。

新增 provider 配置字段：

```text
reject_streaming_content_length
reject_streaming_zero_usage
```

TypeScript 字段：

```text
rejectStreamingContentLength
rejectStreamingZeroUsage
```

相关文件：

- `src/drizzle/schema.ts`
- `src/types/provider.ts`
- `src/repository/_shared/transformers.ts`
- `src/repository/provider.ts`
- `src/actions/providers.ts`
- `src/lib/validation/schemas.ts`
- `src/lib/api/v1/schemas/providers.ts`
- `src/lib/api-client/v1/openapi-types.gen.ts`
- `src/lib/provider-patch-contract.ts`
- `src/app/api/v1/resources/providers/handlers.ts`
- `src/app/[locale]/settings/providers/_components/forms/provider-form/sections/options-section.tsx`
- `messages/*/settings/providers/form/sections.json`
- `src/app/v1/_lib/proxy/streaming-response-guards.ts`
- `src/app/v1/_lib/proxy/forwarder.ts`

运行时行为：

1. 如果 provider 开启 `rejectStreamingContentLength`，且上游 SSE 响应头包含 `content-length`，当前 provider attempt 立即失败。
2. 如果 provider 开启 `rejectStreamingZeroUsage`，代理会先缓冲当前 SSE 响应并检查显式 usage 字段；若显式完整 usage 全为 0，则当前 provider attempt 失败。
3. 命中 guard 后会清理当前 attempt 的超时、AbortController 与 agent 占用，再进入 provider fallback。
4. 对非 hedge 与 hedge 两条流式路径均已接入。
5. guard 错误类型会进入 provider chain，且不会对同一 provider 做无意义的内部 retry。

迁移：

```text
drizzle/0106_organic_squadron_supreme.sql
```

迁移内容使用幂等写法：

```sql
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'vip_group_usage';
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "reject_streaming_content_length" boolean DEFAULT false NOT NULL;
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "reject_streaming_zero_usage" boolean DEFAULT false NOT NULL;
```

## 2. SII Notebook / VSCode deep proxy base-path 支持

SII Notebook / VSCode 网关下，应用真实访问路径可能是深层前缀，例如：

```text
/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/3000
```

本轮在服务端、构建时与浏览器侧做了统一支持。

相关文件：

- `src/proxy.ts`
- `next.config.ts`
- `src/lib/utils/sii-proxy-support.ts`
- `src/lib/utils/base-path.ts`
- `src/lib/utils/fetch-interceptor.ts`
- `src/lib/utils/navigation-interceptor.ts`
- `src/lib/utils/workspace-aware-redirect.ts`
- `src/components/proxy-fetch-initializer.tsx`
- `src/components/customs/footer-wrapper.tsx`
- `src/app/[locale]/layout.tsx`
- `src/app/[locale]/page.tsx`
- `src/app/page.tsx`

关键实现：

- `SII_PROXY_SUPPORT` / `NEXT_PUBLIC_SII_PROXY_SUPPORT` 控制该特性。
- 空值默认启用，保持 Notebook 部署开箱可用。
- `0`、`false`、`no`、`off`、`disabled` 可显式禁用。
- `src/proxy.ts` 负责 canonicalization、重复 `/proxy/<port>` 污染收敛、referer richer base path 恢复、登录跳转清洗。
- `next.config.ts` 依据 `VSCODE_PROXY_URI` / `vscode_proxy_uri` 生成 `assetPrefix`。
- 浏览器侧通过 `base-path.ts`、fetch interceptor、navigation interceptor 让 API 请求与路由跳转自动带上 deep proxy base path。
- root layout 挂载 `ProxyFetchInitializer`，使全局 fetch patch 尽早生效。

维护约束：

- SII 开关关闭时，所有 base-path helper 回退到根路径语义。
- referer 恢复只应从 richer base path 恢复 poorer path，避免跳转污染扩大。
- 能在中间件内完成恢复时优先 in-process reprocess，不应退化为外部 307 / 302 循环。
- workspace bare-locale 根路径应视为真实 app 入口，不能生成自循环跳转页。

## 3. 默认代理端口统一为 3000

本轮将默认代理端口从旧口径统一收敛到 `3000`。

已覆盖：

- `.env.example`
- `deploy/.env.example`
- `dev/Makefile`
- `dev/docker-compose.yaml`
- `docker-compose.yaml`
- `package.json`
- `server.js`
- `src/lib/config/env.schema.ts`
- `README.md`
- `README.en.md`
- `dev/README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `.github/workflows/test.yml`
- `scripts/deploy.sh`
- `scripts/deploy.ps1`
- `scripts/run-e2e-tests.sh`
- `scripts/run-e2e-tests.ps1`
- `scripts/deploy-k8s.sh`
- `docs/*` 中涉及默认本地端口的示例
- `tests/setup.ts`
- E2E / API / security / unit 测试中的默认本地端口 fixture

关键默认值：

```text
PORT=3000
APP_PORT=3000
API_BASE_URL=http://localhost:3000/api/actions
```

已回扫确认当前工作树内不再有旧默认端口字面量残留。

## 4. 登录 branding、公共 site-info 与 footer

登录页未登录态需要展示站点标题，但不应依赖后台权限接口。本轮新增最小公开接口：

```http
GET /api/public/site-info
```

相关文件：

- `src/app/api/public/site-info/route.ts`
- `src/app/[locale]/login/page.tsx`
- `src/components/customs/footer-wrapper.tsx`
- `src/components/proxy-fetch-initializer.tsx`
- `src/app/[locale]/layout.tsx`

当前行为：

- 登录页 branding 走 base-path-aware 的 `apiFetch("/public/site-info")`。
- version 请求走 `apiFetch("/version")`。
- 登录提交走 `apiFetch("/auth/login")`。
- branding 获取失败 fail-open，不阻断登录主流程。
- `/login` 页面通过 `FooterWrapper` 隐藏公共 footer，避免重复展示品牌信息。
- 非登录页保持 footer 正常渲染。

## 5. my-usage / usage logs 的 originalModel 优先语义

发生模型重定向时，用户更关心原始请求模型。因此本轮让 my-usage 与 usage logs 统一使用 billing model source 解析字段。

新增共享 helper：

```text
src/repository/_shared/usage-model-field.ts
```

语义：

```sql
-- billingModelSource = original
COALESCE(originalModel, model)

-- billingModelSource = redirected
COALESCE(model, originalModel)
```

相关文件：

- `src/actions/my-usage.ts`
- `src/actions/usage-logs.ts`
- `src/repository/_shared/usage-log-filters.ts`
- `src/repository/usage-logs.ts`
- `src/repository/message.ts`
- `src/repository/admin-user-insights.ts`

当前行为：

- my-usage 列表展示、summary、breakdown 使用同一模型来源。
- usage logs 查询、筛选、统计与 distinct model 列表使用同一模型来源。
- `message_request` 与 `usage_ledger` 两条路径保持一致。
- admin user insights 的 provider breakdown model filter 也改为使用同一 COALESCE 表达式，不再直接对 `model OR originalModel` 做旁路匹配。
- `findUsageLogs` 兼容入口新增可选 `billingModelSource`，默认保持 original 优先。

## 6. VIP 高成本分组提醒

当命中的 provider 分组精确包含 `vip` 时，请求链路会异步触发 `vip_group_usage` 通知，用于高成本线路审计。

相关文件：

- `src/app/v1/_lib/proxy/vip-group-usage.ts`
- `src/app/v1/_lib/proxy/forwarder.ts`
- `src/app/v1/_lib/proxy/response-handler.ts`
- `src/app/v1/_lib/proxy/stream-finalization.ts`
- `src/lib/redis/vip-group-usage-config.ts`
- `src/lib/notification/notifier.ts`
- `src/lib/notification/notification-queue.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`
- `src/lib/webhook/templates/defaults.ts`
- `src/lib/webhook/templates/placeholders.ts`
- `src/lib/webhook/templates/test-messages.ts`
- `src/actions/notifications.ts`
- `src/actions/notification-bindings.ts`
- `src/actions/webhook-targets.ts`
- `src/app/api/v1/resources/notifications/handlers.ts`
- `src/lib/api/v1/schemas/notifications.ts`
- `src/lib/api/v1/schemas/webhook-targets.ts`
- `src/app/[locale]/settings/notifications/_components/notification-type-card.tsx`
- `src/app/[locale]/settings/notifications/_components/test-webhook-button.tsx`
- `src/app/[locale]/settings/notifications/_lib/hooks.ts`
- `src/app/[locale]/settings/notifications/_lib/schemas.ts`
- `messages/*/settings/notifications.json`

运行时配置：

```text
Redis key: notification:vip-group-usage:config
默认 enabled: true
默认 cooldownSeconds: 300
cooldown 范围: 1..86400 秒
```

去重键：

```text
vip-group-usage-alert:${providerId}:${sessionId || "no-session"}
```

当前机制：

- provider group 使用 `parseProviderGroups()` 精确拆分，`notvip` 不会误命中。
- 仅命中精确 `vip` 分组时发送提醒。
- user 来源优先使用 `session.messageContext.user`，回退 `session.authState.user`。
- 流式与非流式成功链路均已接入。
- 通知使用现有 target / binding / queue / webhook renderer 体系。
- Redis 读取失败 fail-open 为默认配置。
- Redis 保存失败向 UI/API 返回明确错误码。
- 通知发送为 best-effort，不影响代理响应。
- VIP runtime config 保持 Redis-only，没有向 `notification_settings` 增加配置字段。

## 7. Key Soft Block

Key Soft Block 是 Redis-only 临时限制机制，不修改 Key 数据库 schema，也不删除 Key 元数据。

相关文件：

- `src/lib/key-soft-block-store.ts`
- `src/app/v1/_lib/proxy/key-soft-block.ts`
- `src/app/v1/_lib/proxy/auth-guard.ts`
- `src/app/v1/_lib/models/available-models.ts`
- `src/actions/keys.ts`
- `src/actions/users.ts`
- `src/lib/api/v1/schemas/keys.ts`
- `src/lib/validation/schemas.ts`
- `src/lib/utils/error-messages.ts`
- `src/types/key.ts`
- `src/types/user.ts`
- `src/app/[locale]/dashboard/_components/user/forms/add-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/key-edit-section.tsx`
- `src/app/[locale]/dashboard/_components/user/key-row-item.tsx`
- `src/app/[locale]/dashboard/_components/user/user-key-table-row.tsx`
- `messages/*/dashboard.json`
- `messages/*/errors.json`

Redis key：

```text
cch:key-soft-block:${keyId}
```

保存字段：

```json
{
  "enabled": true,
  "message": "optional message"
}
```

当前行为：

- 新增 Key 时可同时写入 soft block 状态与提示词。
- 编辑 Key 时显式提交 soft block 字段会覆盖 Redis 当前配置。
- 用户列表、Key 列表和统计列表会回填 Redis 中的 soft block 状态。
- 编辑弹窗再次打开时，开关与提示词使用 Redis 最新值。
- `auth-guard` 在 API Key 校验成功后立即检查 soft block。
- `/v1/models` 认证成功后读取同一 Redis 配置，保持与主请求链路同口径拦截。
- Gemini `?key=` 查询参数认证在 `/v1/models` 保持可用。
- 命中时统一返回 401，错误类型为 `user_disabled`。
- Redis 写入失败向 UI 返回错误，避免用户误以为保存成功。
- Redis 读取失败 fail-open 为未启用。

错误码：

```text
KEY_SOFT_BLOCK_REDIS_UNAVAILABLE
KEY_SOFT_BLOCK_SAVE_FAILED
PROXY_KEY_SOFT_BLOCKED
```

## 8. opencode Claude Messages 自动追加 beta 参数

opencode 访问 Claude Messages 时需要自动追加 `beta=true`，但不能影响其他客户端或覆盖调用方显式参数。

相关文件：

- `src/app/v1/_lib/proxy/opencode-beta.ts`
- `src/app/v1/_lib/proxy/forwarder.ts`

当前规则：

1. `User-Agent` 包含 `opencode`。
2. provider 类型为 `claude` 或 `claude-auth`。
3. 请求路径为 `/v1/messages`。
4. 上游 URL 尚未显式带 `beta` 参数。

满足以上条件时，最终转发 URL 自动追加：

```text
beta=true
```

边界：

- 非 opencode 不处理。
- 非 Claude provider 不处理。
- 非 `/v1/messages` 不处理。
- 已显式传入 `beta` 时保持原值。

## 9. OpenAPI 与 migration 同步

本轮已执行 OpenAPI 生成，更新：

```text
src/lib/api-client/v1/openapi-types.gen.ts
```

新增/更新的 OpenAPI 面：

- provider schema 包含 `reject_streaming_content_length`。
- provider schema 包含 `reject_streaming_zero_usage`。
- notification type enum 包含 `vip_group_usage`。
- notification settings schema 包含 `vipGroupUsageEnabled` 与 `vipGroupUsageCooldownSeconds`。

migration：

- 新增 `drizzle/0106_organic_squadron_supreme.sql`。
- 新增 `drizzle/meta/0106_snapshot.json`。
- 更新 `drizzle/meta/_journal.json`。
- enum 与 provider columns 均使用幂等写法。

## 10. 明确不包含的能力

按本轮用户要求，当前 patch 不包含错误规则驱动的“流式前缀关键词拦截”能力：

- 未新增对应规则类别。
- 未新增对应 UI。
- 未新增对应 runtime gate。
- 未新增对应测试或文档配置示例。

本轮只保留并实现 `0.8.3` 的 provider streaming response guards。

## 11. 回归测试与验证结果

本轮在当前工作树中完成了定向验证、全量验证与字面量回扫。除特别说明外，以下命令均在仓库根目录执行。

### 11.1 构建、lint 与类型检查

```bash
bun run build
```

结果：通过。构建流程完成 `tsgo -p tsconfig.json --noEmit`、`next build`、standalone version/static/public/custom server copy；最终生成 `/api/public/site-info`、`/api/v1/[...route]`、`/v1/[...route]` 等路由。构建过程中有两类非阻断日志：

- Next.js 提示 workspace root 由上层 `package-lock.json` 推断；
- 静态页生成阶段对本地未迁移 DB 触发 `system_settings` 缺列降级读取 warning。

上述日志未导致构建失败，命令退出码为 `0`。

```bash
bun run lint
```

结果：通过。Biome 输出 `Checked 1883 files ... No fixes applied.`；仅有 `biome.json` schema 版本信息提示（本地 CLI 期望 `2.4.4`，配置声明 `2.4.15`），不影响退出码。

```bash
bun run typecheck
```

结果：通过，`tsgo -p tsconfig.json --noEmit` 退出码为 `0`。

### 11.2 Migration 与 OpenAPI

```bash
bun run validate:migrations
```

结果：通过，新增迁移使用幂等写法并通过检查。

```bash
bun run openapi:generate
bun run openapi:check
bun run openapi:lint
```

结果：通过。OpenAPI client 已生成，schema / lint 检查均通过。

### 11.3 定向单测

Key Soft Block、VIP group usage、opencode beta、provider streaming guards 等新增链路定向回归：

```bash
DSN= AUTO_CLEANUP_TEST_DATA=false bunx vitest run \
  tests/unit/lib/key-soft-block-store.test.ts \
  tests/unit/proxy/key-soft-block.test.ts \
  tests/unit/proxy/auth-guard-account-state.test.ts \
  tests/unit/models/available-models-auth-outcome.test.ts \
  tests/unit/proxy/vip-group-usage.test.ts \
  tests/unit/redis/vip-group-usage-config.test.ts \
  tests/unit/webhook/templates/vip-group-usage.test.ts \
  tests/unit/webhook/notifier-vip-group-usage.test.ts \
  tests/unit/notification/notification-queue.test.ts \
  tests/unit/proxy/proxy-forwarder-opencode-beta.test.ts \
  tests/unit/proxy/streaming-response-guards.test.ts \
  tests/unit/proxy/proxy-forwarder-streaming-response-guards-fallback.test.ts \
  tests/unit/usage-doc/opencode-usage-doc.test.tsx \
  --reporter=dot
```

结果：`13 files, 67 tests passed`。

my-usage / usage logs / originalModel 口径相关定向回归：

```bash
DSN= AUTO_CLEANUP_TEST_DATA=false bunx vitest run \
  tests/unit/actions/my-usage-consistency.test.ts \
  tests/unit/actions/my-usage-token-aggregation.test.ts \
  tests/unit/repository/usage-logs-actual-response-model.test.ts \
  tests/unit/repository/usage-logs-slim-pagination.test.ts \
  tests/unit/repository/leaderboard-user-model-stats.test.ts \
  tests/unit/repository/leaderboard-provider-metrics.test.ts \
  tests/unit/repository/admin-user-insights-overview.test.ts \
  tests/unit/proxy/model-redirect-fallback.test.ts \
  tests/unit/proxy/session.test.ts \
  --reporter=dot
```

结果：`9 files, 84 tests passed`。

provider options UI / patch contract / batch edit 定向回归：

```bash
DSN= AUTO_CLEANUP_TEST_DATA=false bunx vitest run \
  tests/unit/settings/providers/options-section.test.tsx \
  tests/unit/settings/providers/build-patch-draft.test.ts \
  tests/unit/settings/providers/provider-batch-dialog-step1.test.tsx \
  tests/unit/settings/providers/provider-undo-toast.test.tsx \
  tests/unit/actions/providers-patch-contract.test.ts \
  tests/unit/actions/providers-batch-field-mapping.test.ts \
  --reporter=dot
```

结果：`6 files, 262 tests passed`。

SII proxy support / base path 定向回归：

```bash
DSN= AUTO_CLEANUP_TEST_DATA=false bunx vitest run \
  tests/unit/utils/sii-proxy-support.test.ts \
  tests/unit/utils/base-path.test.tsx \
  --reporter=dot
```

结果：`2 files, 10 tests passed`。

### 11.4 全量测试

```bash
DSN= AUTO_CLEANUP_TEST_DATA=false bun run test -- --reporter=dot
```

结果：通过。最新全量测试结果：

```text
Test Files  738 passed | 2 skipped (740)
Tests       6566 passed | 13 skipped (6579)
Duration    132.38s
```

全量测试输出中仍有仓库既有的 DSN fallback、React `act(...)`、KaTeX、i18n missing-message 等 warning / stderr，但测试最终全部通过。

### 11.5 字面量回扫

流式前缀关键词拦截字面量回扫：

```bash
rg -n "stream_prefix_block|STREAM_PREFIX|stream-prefix" src tests messages docs drizzle \
  --glob '!docs/patch-0.8.7.1.md' || true
```

结果：无输出，确认当前 patch 未引入错误规则驱动的流式前缀关键词拦截实现。

旧默认端口字面量回扫：

```bash
rg -n "23000|13500" . --hidden \
  --glob '!node_modules/**' \
  --glob '!.next/**' \
  --glob '!coverage/**' \
  --glob '!docs/patch-0.8.7.1.md' \
  --glob '!bun.lockb' \
  --glob '!bun.lock' \
  --glob '!.git/**' || true
```

结果：无输出，确认默认端口已收敛到 `3000` 口径。

VIP DB settings 字段污染回扫：

```bash
rg -n "vip_group_usage_enabled|vip_group_usage_cost_threshold_usd|vip_group_usage_cooldown|vipGroupUsageCostThreshold" src drizzle tests || true
```

结果：无输出，确认 VIP group usage runtime config 保持 Redis-only，未新增 DB settings 字段。

usage model 旁路筛选回扫：

```bash
rg -n "eq\(usageLedger\.model|eq\(messageRequest\.model|getUsedModels\(|getDistinctModelsForKey\(" src/repository src/actions
```

结果：只剩 `getUsedModels(settings.billingModelSource)` 与 `getDistinctModelsForKey(..., settings.billingModelSource)` 这类已显式传入 billing source 的调用；未发现直接 `eq(model)` 旁路筛选残留。

## 12. 发布分支与版本口径

- 发布分支：`0.8.7`
- 发布版本：`0.8.7.1`
- `VERSION` 文件：`0.8.7.1`
- GitHub Release tag 建议：`v0.8.7.1`
- 因 `package.json` 使用 npm semver 三段版本约束，当前不把 `package.json.version` 改为四段版本。运行时与镜像版本以 `VERSION` / release tag 为准。

## 13. 后续维护约束

1. SII base path
   - `src/proxy.ts`、`next.config.ts`、浏览器侧 base path utilities 必须同步维护。
   - 默认端口继续保持 `3000`。
   - `SII_PROXY_SUPPORT=false` 必须能关闭 deep proxy 行为。

2. Provider streaming response guards
   - provider schema、repository transformer、action patch contract、OpenAPI、UI batch edit 必须保持字段同步。
   - guard 命中必须走 provider fallback，而不是把部分 SSE 下发给客户端。

3. originalModel 语义
   - 展示、筛选、聚合、distinct model、admin insights 入口必须使用同一 billing model source。
   - `message_request` 与 `usage_ledger` 两条路径必须同步修改。

4. VIP group usage
   - runtime config 保持 Redis-only。
   - 不新增 `notification_settings` 字段保存 enabled/cooldown。
   - `vip_group_usage` enum migration 必须保持幂等。
   - webhook payload 中 provider group 字段必须忠实反映 provider group，不得误写成 key group。

5. Key Soft Block
   - 保持 Redis-only，不引入 keys/users DB schema 字段。
   - Redis 写失败必须向 UI/API 返回错误。
   - Redis 读失败 fail-open。
   - `/v1/models` 与主请求链路必须保持同口径 401 `user_disabled` 拦截。

6. opencode beta
   - 只作用于 opencode + Claude / Claude Auth + `/v1/messages`。
   - 不覆盖调用方显式 `beta` 参数。
