# SII Support、登录 Branding 与 Key Soft Block 实现说明（v0.7.3）

本文档记录当前 `main` 分支在 `VERSION=0.7.3` 基线上的功能回补边界。该回补参考
`0.6.8` 分支提交 `2e2bb340fa42fcd96c1174f5e3118b0b31fe0849` 的能力要求，但不是
简单复制旧 diff，而是在当前 main 代码结构上按功能语义做增量实现。

当前文档覆盖以下主线：

1. SII Notebook / VSCode 深层代理前缀支持继续收敛
2. 默认代理端口统一为 3000
3. 登录 branding 与公共 footer 调整
4. my-usage / usage logs 的 originalModel 优先语义
5. VIP 高成本分组提醒 `vip_group_usage` 全链路接入
6. Key Soft Block 的 Redis 写入、Redis 回读、代理拦截与编辑回填闭环
7. opencode 调用 Claude `/v1/messages` 时自动追加 `beta=true`
8. 基于错误规则的流式前缀拦截 `stream_prefix_block`

## 1. SII Notebook / VSCode 深层代理前缀

在 SII Notebook 网关下，应用真实访问路径通常不是根路径，而是类似：

```text
/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/3000
```

当前实现继续保持服务端、构建时与客户端三层协同：

- `src/proxy.ts` 负责 canonicalization、污染路径收敛、referer 恢复边界控制与登录跳转清洗。
- `next.config.ts` 负责根据 `VSCODE_PROXY_URI` / `vscode_proxy_uri` 生成 `assetPrefix`。
- `src/lib/utils/base-path.ts`、`fetch-interceptor.ts`、`navigation-interceptor.ts` 与
  `workspace-aware-redirect.ts` 负责浏览器侧 base path 感知。

关键约束：

- `process.env.PORT || "3000"` 是默认代理端口来源。
- referer 恢复只允许 richer base path 恢复 poorer path。
- 可在中间件内完成的路径恢复优先使用 in-process reprocess，不回退到外部 307 / 302。
- workspace bare-locale 根路径必须当成真实 app 入口处理，不能生成跳回自身的自循环页面。
- 当 Notebook 网关在服务端请求中剥离 workspace 前缀，只暴露 `/` 或短 `/proxy/<port>` 时，登录重定向也不能直接返回 307；
  必须走浏览器侧相对跳转页，让 `window.location.pathname` 恢复真实 deep proxy base path。
- 登录 `from` 参数必须清洗重复 locale 与污染的 `/proxy/<port>` 前缀。

## 2. 登录 branding 与公共 footer

登录页未登录态需要展示站点标题，但不应该依赖后台权限接口或过重配置接口。当前实现使用最小公开接口：

```http
GET /api/public/site-info
```

相关文件：

- `src/app/api/public/site-info/route.ts`
- `src/app/[locale]/login/page.tsx`
- `src/components/customs/footer-wrapper.tsx`
- `src/components/proxy-fetch-initializer.tsx`

当前规则：

- 登录页 branding 请求走 base-path 感知的 `apiFetch("/public/site-info")`。
- version 请求走 `apiFetch("/version")`。
- 登录提交走 `apiFetch("/auth/login")`。
- 根 layout 挂载 `ProxyFetchInitializer`。
- `/login` 页面通过 `FooterWrapper` 隐藏公共 footer，避免重复品牌信息。
- branding 获取失败必须 fail-open，不影响登录主流程。

## 3. originalModel 优先语义

发生模型重定向时，用户更关心原始请求模型，而不是最终转发模型。因此 my-usage 与 usage logs
统一使用原始模型优先语义：

```sql
COALESCE(originalModel, model)
```

相关文件：

- `src/actions/my-usage.ts`
- `src/actions/usage-logs.ts`
- `src/repository/_shared/usage-log-filters.ts`
- `src/repository/usage-logs.ts`

当前规则：

- my-usage 列表优先展示 `originalModel`。
- summary / breakdown 聚合按 `COALESCE(originalModel, model)`。
- usage logs 查询、筛选、统计与 distinct model 列表使用同一模型来源。
- message_request 与 usage_ledger 两条路径保持同一语义。
- 只读 my-usage API 的 `startDate` / `endDate` 继续按 **system timezone** 解释；测试与排障时不能直接拿 UTC
  `toISOString().slice(0, 10)` 当成查询日历日，而应使用与 `resolveSystemTimezone()` 同口径的
  `YYYY-MM-DD`。
- 为避免跨日边界导致的伪失败，readonly my-usage 的 DB 集成测试时间戳固定会额外回退 10 分钟，
  让“当天”用例稳定落在服务端时区同一天窗口内。

维护约束：

- 展示、筛选、聚合、模型下拉与统计摘要必须保持同一语义。
- 如果 UI 选择原始模型优先，SQL 层也必须统一使用 `COALESCE(originalModel, model)`。
- 若接口参数仍使用 `startDate` / `endDate` 字符串，则调用方、测试辅助函数与文档样例都必须和
  `parseDateRangeInServerTimezone()` 保持同一时区口径；否则容易出现“full batch 有数据但 summary 为 0”
  的假失败。

## 4. VIP 高成本分组提醒

当命中的 provider `groupTag` 包含 `vip` 时，请求链路异步触发 `vip_group_usage` 提醒，用于高成本线路审计与误用发现。

相关文件：

- `src/app/v1/_lib/proxy/forwarder.ts`
- `src/lib/redis/vip-group-usage-config.ts`
- `src/lib/notification/notifier.ts`
- `src/lib/notification/notification-queue.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`
- `drizzle/0099_tough_ultimates.sql`

当前机制：

- Redis 配置默认 `enabled=true`。
- Redis 冷却窗口默认 300 秒。
- 去重键为 `vip-group-usage-alert:${providerId}:${sessionId || "no-session"}`。
- 接入现有 notification target、binding、queue、Webhook renderer 与 test message。
- `vip_group_usage` enum 迁移使用 `ADD VALUE IF NOT EXISTS`，避免半漂移环境重复执行失败。
- 默认模板字段必须忠实反映 payload，不能把 provider group 错标成 key group。

## 5. Key Soft Block

Key Soft Block 是 Redis-only 的临时限制机制，不修改 Key 数据库 schema，也不删除 Key 元数据。

相关文件：

- `src/lib/key-soft-block-store.ts`
- `src/actions/keys.ts`
- `src/actions/users.ts`
- `src/app/[locale]/dashboard/_components/user/forms/add-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/key-edit-section.tsx`
- `src/app/v1/_lib/proxy/key-soft-block.ts`
- `src/app/v1/_lib/proxy/auth-guard.ts`
- `src/app/v1/_lib/models/available-models.ts`

Redis key：

```text
cch:key-soft-block:${keyId}
```

保存字段：

- `enabled`
- `message`

当前行为：

- 新增 Key 时可同时写入 soft block 状态与提示词。
- 编辑 Key 时显式提交 soft block 字段会覆盖 Redis 当前配置。
- 用户列表与 Key 列表返回结果会回填 Redis 中的 soft block 状态。
- 编辑弹窗再次打开时，开关与提示词使用 Redis 最新值回填。
- `auth-guard` 在 API Key 校验成功后立即检查 soft block。
- `/v1/models` 认证成功后也读取同一份 Redis 配置。
- Gemini `?key=` 查询参数认证在 `/v1/models` 保持可用。
- 命中时统一返回 401，错误类型为 `user_disabled`。

维护约束：

- Key Soft Block 继续保持 Redis-only，不引入 DB schema 绑定。
- Redis 写入失败时必须向 UI 返回错误，避免误以为保存成功。
- Redis 读取失败时 fail-open 为未启用。
- `/v1/models` 与主请求链路必须保持同口径拦截。

## 6. opencode Claude Messages beta 参数

opencode 访问 Claude Messages 时需要自动追加 `beta=true`，但不能影响其他客户端或覆盖调用方显式参数。

相关文件：

- `src/app/v1/_lib/proxy/forwarder.ts`

当前规则：

- 客户端 User-Agent 命中 opencode。
- 目标 provider 类型为 `claude` 或 `claude-auth`。
- 请求路径为 `/v1/messages`。
- 上游 URL 尚未显式带 `beta` 参数。

满足以上条件时，最终转发 URL 自动追加：

```text
beta=true
```

边界：

- 仅作用于 opencode。
- 仅作用于 Claude Messages。
- 调用方已经显式传入 `beta=...` 时保持原值。

## 7. 基于错误规则的流式前缀拦截

当前 `main` / `0.7.3` 还额外补了一条**不增加数据库字段**的运行时能力：

- 目标：对于流式 SSE 响应，如果前缀扫描窗口内命中指定关键词，则**整条流不再下发给客户端**。
- 配置载体：继续复用现有 error rules，不新增 schema / migration。
- 规则类别：`stream_prefix_block`。

相关文件：

- `src/lib/stream-prefix-block-rule.ts`
- `src/lib/error-rule-detector.ts`
- `src/app/v1/_lib/proxy/errors.ts`
- `src/app/v1/_lib/proxy/forwarder.ts`
- `src/app/v1/_lib/proxy/stream-prefix-block-gate.ts`
- `src/app/v1/_lib/proxy/response-handler.ts`
- `src/app/v1/_lib/proxy/error-handler.ts`
- `src/actions/error-rules.ts`
- `src/app/[locale]/settings/error-rules/_components/add-rule-dialog.tsx`
- `src/app/[locale]/settings/error-rules/_components/edit-rule-dialog.tsx`
- `src/app/[locale]/settings/error-rules/_components/rule-list-table.tsx`

### 7.1 配置约定

规则仍然通过 dashboard 的 Error Rules 页面录入，但字段语义有额外约定：

- 界面“规则类别”显示名：`流前缀拦截`
- `category = stream_prefix_block`
- `pattern`：兜底关键词
- `description`：JSON 配置
- `matchType`：在 action 层会被强制收敛为 `contains` 语义，不走 regex 校验与测试器逻辑

`description` JSON 示例：

```json
{
  "scanLimitBytes": 4096,
  "keywords": ["175877552", "公益token通知群"],
  "providerIds": [12, 18, 33],
  "statusCode": 403,
  "message": "Response blocked by stream prefix policy"
}
```

字段语义：

- `scanLimitBytes`：支持任意正整数，单位是字节；默认 `65536`。
- `keywords`：实际扫描关键词数组；若留空，则回退使用 `pattern`。
- `providerIds`：仅对指定 provider 生效；缺省表示全局生效。
- `statusCode`：命中后返回给客户端的状态码，默认 `403`。
- `message`：命中后返回给客户端的错误文案。
- 若同时配置了 rule 自带的 `overrideResponse` / `overrideStatusCode`，则仍按现有错误规则覆写机制生效；
  其中 `overrideStatusCode` 优先级高于 `description.statusCode`。

### 7.2 运行时行为

当前实现走的是“严格版前缀门禁 + provider fallback”，而不是命中后才中途掐断的普通流式模式：

1. 仅当当前 provider 命中 `providerIds` 范围时才启用。
2. `forwarder` 在把 SSE 响应真正视为成功之前，先读取 `scanLimitBytes` 指定的前缀窗口。
3. 若命中关键词：
   - 立即取消上游 reader
   - 清理当前 attempt 的超时 / agent 占用
   - 把当前 provider 记为 `stream_prefix_block` 失败
   - 若还有可用 provider，则继续尝试下一个 provider
   - 若所有 provider 都失败，才返回配置的 JSON 错误响应
4. 若未命中：
   - 将已读前缀 chunk 回吐
   - 后续继续透传整条 SSE 流

这保证了：**一旦命中，客户端看不到任何部分 SSE 内容**。

补充说明：

- 检查发生在前缀窗口读取完成、真正把响应继续透传给客户端之前，因此命中时不会出现“先给 200，再在 SSE 中途塞一个错误”的混合行为。
- 如果只是某一个 provider 命中该规则，而后续 provider 成功，则最终客户端看到的仍然是后续 provider 的正常 SSE 响应；
  管理后台的 provider chain 会记录前一个 provider 的 `stream_prefix_block` 失败轨迹。
- `response-handler` 仍保留同语义的兜底 gate；正常路径下由 `forwarder` 预扫描并决定是否继续 fallback。
- 单请求的额外内存开销只与前缀扫描窗口有关。当前默认窗口是 `64 KiB`，但可以改成更小的任意正整数；
  也就是说，严格版前缀门禁的额外缓冲上限就是一个前缀窗口加对应的解码字符串开销，而不是把整条流完整读入内存。

### 7.3 维护约束

- 继续保持“错误规则 + description JSON”方案，不要偷偷引入新的 DB 字段。
- provider 作用域、扫描窗口、关键词语义都必须在 UI / action / runtime 保持一致。
- 该规则只作用于流式响应前缀门禁，不应污染普通 contains / exact / regex 错误匹配链。
- 规则缓存 reload 时，如果 `description` 不是合法 JSON、`pattern` 与 `keywords` 最终都为空，运行时会忽略该规则并打 warning，
  而不是让整套 error rules 加载失败。

### 7.4 相关测试覆盖

这轮为 `stream_prefix_block` 及其联动补了对应回归：

- `tests/unit/lib/stream-prefix-block-rule.test.ts`
- `tests/unit/proxy/response-handler-stream-prefix-block.test.ts`
- `tests/unit/proxy/proxy-forwarder-stream-prefix-block-fallback.test.ts`
- `tests/integration/error-rule-detector.test.ts`
- `tests/integration/proxy-errors.test.ts`
- `tests/integration/e2e-error-rules.test.ts`

## 8. 验证结果

当前这轮文档同步时，实际重新执行并确认通过的是：

```bash
bun run typecheck
DSN= AUTO_CLEANUP_TEST_DATA=false bunx vitest run \
  tests/unit/lib/stream-prefix-block-rule.test.ts \
  tests/unit/proxy/response-handler-stream-prefix-block.test.ts \
  tests/unit/proxy/proxy-forwarder-stream-prefix-block-fallback.test.ts \
  --reporter=dot
```

验证结果：

- `typecheck` 通过。
- 上述 `stream_prefix_block` 相关定向回归通过：`3 files, 9 tests passed`。
- readonly my-usage 这轮新增补充验证：

  ```bash
  ALLOW_NON_TEST_DB=true bunx vitest run -c tests/configs/my-usage.config.ts \
    tests/api/my-usage-readonly.test.ts
  ```

  结果：`1 file, 10 tests passed`。
- 在允许非 test DB 的现场约束下，已额外完成 full suite 验证：

  ```bash
  ALLOW_NON_TEST_DB=true bun run test
  ```

  结果：`564 passed | 1 skipped (565 files)`，`5257 passed | 3 skipped (5260 tests)`，
  总耗时 `133.23s`（2026-05-14 现场实跑）。
- 这轮 my-usage readonly 修复结论也一并记录：失败根因是**测试日期字符串与服务端时区口径不一致**，
  不是 `getMyStatsSummary` 聚合 SQL 或 imported ledger 合并逻辑回退。

说明：

- 本轮重点是把新增的 `stream_prefix_block` provider fallback 语义补齐，因此这里记录的是**这轮实际重跑并拿到结果**的命令。
- 后续在同一 `0.7.3` 工作树里又继续推进了 full-suite 首测冷启动稳定化；截至这版文档同步时，已额外单独回归通过的代表性用例包括：
  - `tests/security/session-contract.test.ts`
  - `tests/unit/actions/providers-api-test.test.ts`
  - `tests/unit/public-status/system-config-publish.test.ts`
  - `tests/unit/proxy/provider-selector-total-limit.test.ts`
  - `tests/unit/proxy/provider-selector-resource-endpoints.test.ts`
  - `tests/unit/repository/provider-restore.test.ts`
  - `tests/unit/repository/provider-endpoints.test.ts`
- 这些测试稳定化属于“提交流水线护栏补强”，不是本文件主体功能语义的一部分；因此这里只做验证记录，不把它们展开成新的功能章节。
- `lint` 当前还受两类仓库外部因素影响：
  - 本地 Biome CLI 版本 `2.4.4` 与仓库 `biome.json` schema `2.4.12` 不一致；
  - 仓库内已有未格式化文件 `tests/integration/usage-ledger.test.ts`。

## 9. 后续维护约束

后续修改时必须优先保持以下一致性：

1. 路径 canonicalization 一致性
   - `src/proxy.ts` 与 `next.config.ts` 的默认端口和前缀算法必须同步维护。
   - 不要轻易把 in-process reprocess 改回外部 307 / 302。
   - workspace bare-locale 根路径必须当成真实 app 入口处理。

2. originalModel 语义一致性
   - 展示、筛选、聚合、模型下拉与统计摘要必须围绕同一模型来源。
   - message_request 与 usage_ledger 两条路径必须同步修改。

3. notification 与 Key Soft Block 运行时一致性
   - notification type、迁移、模板字段与测试消息必须保持一致。
   - `vip_group_usage` 模板字段必须忠实反映真实 payload。
   - Key Soft Block 仍然保持 Redis-only。
   - `/v1/models` 与主请求链路必须保持同口径拦截。
