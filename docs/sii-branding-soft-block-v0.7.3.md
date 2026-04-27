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

维护约束：

- 展示、筛选、聚合、模型下拉与统计摘要必须保持同一语义。
- 如果 UI 选择原始模型优先，SQL 层也必须统一使用 `COALESCE(originalModel, model)`。

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

## 7. 验证结果

本次 v0.7.3 回补后的本地验证命令：

```bash
bun run lint:fix
bun run lint
bun run typecheck
bun run build
DSN= bun run test
```

验证结果：

- `bun run lint:fix` 通过。
- `bun run lint` 通过。
- `bun run typecheck` 通过。
- `bun run build` 通过。
- `DSN= bun run test` 全量通过：`560 passed | 2 skipped`，`5235 passed | 13 skipped`。

## 8. 后续维护约束

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
