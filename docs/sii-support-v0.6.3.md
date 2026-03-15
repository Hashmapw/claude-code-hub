# SII Support 与登录 Branding 实现说明（基于当前 main 的等价实现）

本文档记录当前 `main` 分支已经落地的、等价于 `0.6.3` 分支 `35ec36e4b7cec60e6d8596a7adbe95f8fc00c7d0` 及其配套说明中的关键能力。

这不是“逐文件抄 diff”，而是当前代码基线上真实已经实现的机制说明，以及这轮补修后新增的维护约束。

当前文档覆盖 5 条主线：

- SII Notebook / VSCode 深层代理前缀支持继续收敛
- 默认代理端口统一为 `3000`
- 登录 branding 与公共 footer 调整
- `my-usage` / usage logs 的 `originalModel` 优先语义
- VIP 高成本分组提醒（`vip_group_usage`）全链路接入

另外，本文档也补充记录了本轮在 `main` 上继续修掉的 4 个后续问题：

- `usage-logs` repository 层的剩余 model filter / distinct-model 语义补齐
- 登录页 branding / version 首屏请求改为 base-path 感知，避免挂载时序竞态
- `vip_group_usage` 默认模板字段语义纠正，不再把 provider group 错标成 key group
- workspace bare-locale 根路径（`.../proxy/3000/zh-CN`）恢复成正确的登录/首页跳转语义，不再生成自循环跳转页

目标读者：

- 后续版本维护者
- 需要在 `main` 上继续维护这套代理路径 / branding / usage / notification 语义的开发者

---

## 1. 背景与问题定义

### 1.1 SII Notebook / VSCode 深层代理前缀

在 SII Notebook 网关下，应用真实访问路径通常不是根路径，而是类似：

`/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/3000`

历史问题主要集中在 5 类：

- canonical workspace path 被错误污染成前置 `/proxy/<port>` 的形式
- `/_next/static/*` 前缀回退到错误端口，导致静态资源 404 / 500
- referer 恢复逻辑可能把 richer workspace path 错降级成短路径
- 登录 `from` 参数里残留污染 `/proxy/<port>` 前缀
- workspace bare-locale 根路径，例如 `.../proxy/3000/zh-CN`，可能被错误生成为“跳回自己”的 HTML redirect，从而出现浏览器自循环

### 1.2 登录 branding 与公共 footer

登录页需要在未登录态展示站点标题，但不应该依赖后台权限接口或过重配置接口。

同时登录页本身已经有自己的品牌区块，全站公共 footer 若继续显示，会造成：

- branding 重复
- 标题 / 版本重复
- 登录页视觉噪音增加

除此之外，SII / Notebook base-path 场景下还存在一个运行时问题：

- 如果 branding 请求是裸 `fetch("/api/...")`
- 而 base-path fetch patch 又是在另一个 `useEffect` 中挂载

则首屏 branding / version 取数可能在 patch 生效前直接请求到根路径，表现为“偶发回退默认标题”。

### 1.3 `my-usage` / usage logs 的模型显示语义

发生模型重定向时，用户更关心“原始请求模型”，而不是最终转发模型。

因此展示、筛选、聚合都必须围绕：

`COALESCE(originalModel, model)`

如果只改某一层，会出现这些回归：

- 列表显示原始模型，但筛选仍按最终模型
- `my-usage` breakdown 看起来对，但 usage logs distinct model 列表仍然是 redirected model
- ledger fallback 路径和主表路径表现不一致

### 1.4 VIP 高成本分组提醒

当命中的 provider `groupTag` 包含 `vip` 时，需要发出请求级提醒，用于：

- 高成本线路审计
- 误用 VIP provider 的快速发现
- 结合 webhook target / binding / test message 做完整通知链路联调

要求：

- Redis 可配置开关，默认开启
- 接入现有 notification target + binding 体系
- Redis 可配置去重阈值，默认 300 秒
- 同一供应商 + 同一 sessionId 在去重窗口内只提醒一次
- 支持模板变量与测试消息

---

## 2. 总体设计

### 2.1 路径与静态资源

当前实现仍然是“三层协同”：

- 服务端 `src/proxy.ts` 负责 canonicalization、污染路径收敛、referer 恢复边界控制
- 构建时 `next.config.ts` 负责 `assetPrefix`
- 客户端 `base-path` / redirect / fetch / navigation 体系负责浏览器侧补前缀和入口跳转

这次 `main` 上的实现除了延续原 `0.6.3` 思路，还补了一个重要收口：

- workspace bare-locale 根路径要和普通 app 入口一样处理，不能落到“跳回自己”的相对跳转页

### 2.2 登录 branding

登录页通过最小公开接口获取 branding：

- `GET /api/public/site-info`

同时在根 layout 中：

- 挂载 `ProxyFetchInitializer`
- 用 `FooterWrapper` 对 `/login` 隐藏公共 footer

登录页请求现在直接走 base-path 感知的 `apiFetch(...)`，不再依赖挂载期 fetch patch 的时序。

### 2.3 `my-usage` / usage logs 模型语义

模型展示与聚合统一按“原始模型优先”：

- `my-usage` 列表优先展示 `originalModel`
- summary / breakdown 聚合按 `COALESCE(originalModel, model)`
- usage logs repository 的筛选、统计、distinct model 列表也按同一语义

### 2.4 VIP 使用提醒

通知链路仍然是：

- 请求链路触发
- notifier 去重与启停
- notification queue 入队
- webhook template 渲染与测试发送

但当前文档特别强调一件事：

- 模板字段必须忠实反映真实 payload
- 不能把 `providerGroupTag` 伪装成 `keyGroup`

---

## 3. 关键实现细节

### 3.1 `src/proxy.ts`：路径 canonicalization、referer 恢复与 bare-locale 根路径修正

#### 统一端口与 env base path

`getEnvProxyBasePath()` 统一使用：

- `process.env.PORT || "3000"`

这和 `next.config.ts` 保持一致。

#### referer 恢复只允许 richer base path 覆盖 poorer path

通过：

- `shouldRecoverFromRefererBase(recoverPath, refererBasePath)`

坚持：

- 只有 `refererSegments > currentSegments` 才允许恢复

目的：

- 已经是 canonical workspace path 的请求不能被短 referer 降级
- 只允许用 richer referer 恢复丢失中间 workspace 段的路径

#### in-process reprocess，不走外部 307

`reprocessWithCanonicalEnvPath()` 继续坚持：

- clone request
- 递归调用 `proxyHandler`
- 补 `x-cch-proxy-rev`

这能避免 Notebook 网关把 `Location` 再次改写成污染路径。

#### workspace bare-locale 根路径现在会被当成真实 app 入口

本轮补修的重点之一：

此前 `extractWorkspaceAppPath()` 对

- `.../ws-.../proxy/3000/zh-CN`

这种 bare-locale 根路径直接返回 `null`，结果后续落入 `convertToRelativeRedirect(...)`，生成目标仍是当前 URL 的 HTML redirect 页面，浏览器执行 `window.location.replace(...)` 后就会自循环。

现在这个特殊排除已经移除，行为恢复为：

- 有 auth cookie：rewrite 到 `/{locale}`，再由应用首页继续到 `/dashboard`
- 无 auth cookie：进入未登录跳转链路，跳到 `/{locale}/login`

这条规则非常重要，因为它直接决定 SII live URL 会不会出现“反复请求同一根地址”的问题。

### 3.2 `next.config.ts`：`assetPrefix` 与 `3000` 端口统一

`getAssetPrefix()` 的关键规则：

- 读取 `VSCODE_PROXY_URI` / `vscode_proxy_uri`
- 用 `process.env.PORT || "3000"` 替换 `{{port}}`
- 调用 `collapseDuplicatedLeadingProxyPrefix()`

这决定了：

- 页面生成的 `/_next/*` 前缀
- 线上是否还会退回到 `proxy/4000/_next/static/...`

### 3.3 登录 redirect safety：清洗 `from` 参数中的污染前缀

`src/app/[locale]/login/redirect-safety.ts` 里：

- `sanitizeRedirectPath()`
- `collapseDuplicatedLeadingProxyPrefix()`

除了原有 open redirect 防护，还会清洗类似：

- `/proxy/3000/ws-a/proxy/3000/zh-CN/dashboard`

确保登录成功后的 `from` 参数不会再次把污染路径带回应用。

### 3.4 登录 branding：最小公开接口 + base-path 感知请求 + 隐藏公共 footer

#### 公开站点标题接口

文件：

- `src/app/api/public/site-info/route.ts`

行为：

- 内部读取 `getSystemSettings()`
- 对外仅返回 `{ siteTitle }`
- 失败时回退 `"Claude Code Hub"`

#### 登录页请求方式

文件：

- `src/app/[locale]/login/page.tsx`

当前关键点有两个：

1. branding 请求改为：
   - `apiFetch("/public/site-info")`
2. version 请求改为：
   - `apiFetch("/version")`

这样即使 `ProxyFetchInitializer` 的 fetch patch 还在挂载中，登录页也能直接按当前 base path 发请求，不依赖 `useEffect` 执行顺序。

#### 登录提交

登录提交也统一改为：

- `apiFetch("/auth/login")`

避免 Notebook base-path 场景下认证请求前缀丢失。

#### 登录页隐藏公共 footer

文件：

- `src/components/customs/footer-wrapper.tsx`

行为：

- `usePathname()`
- `pathname.endsWith("/login")` 时返回 `null`

根 layout 仍保留统一 footer 挂载方式，不需要单独拆 layout。

### 3.5 `my-usage` / usage logs：`originalModel` 优先语义彻底收齐

#### `my-usage`

文件：

- `src/actions/my-usage.ts`

当前行为：

- `getMyTodayStats()` 聚合按 `COALESCE(originalModel, model)`
- `getMyUsageLogs()` 展示优先 `originalModel`
- `modelRedirect` 固定为 `null`
- `billingModelSource` 固定回 `"original"`
- `getMyStatsSummary()` breakdown 按 `COALESCE(originalModel, model)`

#### repository 层剩余漏点已补齐

文件：

- `src/repository/_shared/usage-log-filters.ts`
- `src/repository/usage-logs.ts`

这轮后续补修的重要变化：

- `buildUsageLogConditions()` 的 model filter 改为 `COALESCE(...)`
- `findUsageLogsBatch()` 主表与 ledger fallback 的 model filter 都改为 `COALESCE(...)`
- `findUsageLogsForKeySlim()` ledger fallback 的 model filter 改为 `COALESCE(...)`
- `findUsageLogsStats()` ledger 路径的 model filter 改为 `COALESCE(...)`
- `getDistinctModelsForKey()` 改为返回 `COALESCE(...)`
- `getUsedModels()` 也改为返回 `COALESCE(...)`

结果是：

- 展示、筛选、聚合、模型下拉、统计摘要统一到同一语义
- message_request 与 usage_ledger 不再出现一边 original、一边 redirected 的分裂行为

### 3.6 VIP 使用提醒全链路

#### 触发点

文件：

- `src/app/v1/_lib/proxy/forwarder.ts`

行为：

- provider 选中成功后拆 `currentProvider.groupTag`
- `trim + lowercase`
- 包含 `vip` 时异步 import notifier
- 调用 `sendVipGroupUsageAlert(...)`

这是非阻塞触发：

- 不影响主请求成功返回
- 告警失败不会打断正常代理请求

#### 去重与启停

文件：

- `src/lib/redis/vip-group-usage-config.ts`
- `src/actions/notifications.ts`
- `src/lib/notification/notifier.ts`

行为：

- 运行时配置存放在 Redis，不再落到 `notification_settings` 表
- 默认配置：
  - `enabled = true`
  - `cooldownSeconds = 300`
- 设置页修改后写回 Redis
- 配置 key：
  - `notification:vip-group-usage:config`
- Redis 去重 key 当前是：
  - `vip-group-usage-alert:${providerId}:${sessionId || "no-session"}`
- TTL：
  - `cooldownSeconds`

当前去重粒度是 `providerId + sessionId`。这是当前实现的真实行为，不是文档推测。

#### 队列与模板

文件：

- `src/lib/notification/notification-queue.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`
- `src/lib/webhook/templates/defaults.ts`
- `src/lib/webhook/templates/placeholders.ts`
- `src/lib/webhook/templates/test-messages.ts`
- `src/lib/webhook/types.ts`

当前状态：

- `NotificationJobType` / `WebhookNotificationType` 已全链路接通
- 支持测试消息
- 默认模板字段现在使用真实的：
  - `providerGroupTag: "{{provider_group_tag}}"`

本轮纠正前存在的问题是：

- 默认模板把 provider group 错写成了 `keyGroup`
- 占位符里还暴露了不存在于 payload 的 `{{key_group}}`

现在该语义已经收敛，模板变量和真实 payload 一致。

### 3.7 数据库与设置链路

VIP 提醒对应的 notification type / binding / target 仍然接通，运行时开关与去重阈值则改为 Redis 配置：

- `src/drizzle/schema.ts`
- `src/repository/notifications.ts`
- `src/repository/notification-bindings.ts`
- `src/actions/notification-bindings.ts`
- `src/actions/notifications.ts`
- `src/actions/webhook-targets.ts`
- `src/app/api/actions/[...route]/route.ts`
- `src/app/[locale]/settings/notifications/_lib/hooks.ts`
- `src/app/[locale]/settings/notifications/_lib/schemas.ts`
- `src/app/[locale]/settings/notifications/_components/notification-type-card.tsx`
- `src/app/[locale]/settings/notifications/_components/test-webhook-button.tsx`
- `src/lib/redis/vip-group-usage-config.ts`
- `messages/*/settings/notifications.json`

数据库侧保留：

- `notification_type` enum 值：`vip_group_usage`

Redis 侧新增：

- 开关：`enabled`
- 去重阈值：`cooldownSeconds`

#### 新迁移

当前 `main` 基线上生成的新迁移是：

- `drizzle/0083_yielding_rhodey.sql`

当前它只负责 `notification_type` 增补，不再包含 `vip_group_usage_enabled` 这类运行时配置字段。

- `ALTER TYPE ... ADD VALUE` 被包进 `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL`

这样可以避免环境漂移时出现：

- `enum label already exists`

---

## 4. 测试与验证

本轮优先关注的测试集：

路径与端口相关：

- `tests/unit/proxy/proxy-env-base-path.test.ts`
- `tests/unit/proxy/proxy-auth-cookie-passthrough.test.ts`
- `tests/unit/auth/login-redirect-safety.test.ts`
- `tests/unit/lib/base-path-dynamic.test.ts`

`my-usage` / usage logs `originalModel` 语义：

- `tests/unit/actions/my-usage-original-model-display.test.ts`
- `tests/unit/repository/usage-logs-sessionid-filter.test.ts`

VIP 告警与模板：

- `tests/unit/webhook/notifier-vip-group-usage.test.ts`
- `tests/unit/webhook/templates/placeholders.test.ts`
- `tests/unit/webhook/templates/templates.test.ts`

本轮实际验证结果：

- `bun run typecheck` 通过
- 定向测试通过：

```bash
ALLOW_NON_TEST_DB=true bun run test -- \
  tests/unit/repository/usage-logs-sessionid-filter.test.ts \
  tests/unit/auth/login-redirect-safety.test.ts \
  tests/unit/lib/base-path-dynamic.test.ts \
  tests/unit/proxy/proxy-env-base-path.test.ts \
  tests/unit/proxy/proxy-auth-cookie-passthrough.test.ts \
  tests/unit/actions/my-usage-original-model-display.test.ts \
  tests/unit/webhook/notifier-vip-group-usage.test.ts \
  tests/unit/webhook/templates/placeholders.test.ts \
  tests/unit/webhook/templates/templates.test.ts
```

结果：

- `9` 个 test files
- `71` 个 tests
- 全部通过

另外，针对 workspace bare-locale 根路径还补了专门测试：

- 有 cookie 时 rewrite 到 locale app route
- 无 cookie 时返回 login 跳转页

### live 验证补充

用真实 Notebook URL 验证时，需要区分：

- 本地代码是否已修
- 线上运行实例是否已经部署到新代码

这轮 live 诊断里已经确认，线上旧实例会在：

- `.../proxy/3000/zh-CN`

返回一段目标仍为当前 URL 的 HTML redirect 页面，从而触发浏览器自循环。

如果 live 仍出现该问题，优先检查是否只是部署未更新，而不是本地修复缺失。

---

## 5. 后续修改必须遵守的规则

### 5.1 修改 SII 路径逻辑时

1. `src/proxy.ts` 与 `next.config.ts` 的默认端口和前缀算法必须同步维护。
2. 不要轻易把 in-process reprocess 改回外部 307/302。
3. referer 恢复必须坚持“只允许 richer base path 恢复 poorer path”。
4. workspace bare-locale 根路径（例如 `.../proxy/3000/zh-CN`）必须当成真实 app 入口处理，不能再次落回“跳回自己”的 HTML redirect。
5. 新增路径规则后至少补三类测试：
   - 污染路径输入
   - canonical path 不降级
   - bare-locale 根路径不自循环

### 5.2 修改登录 branding 时

1. `api/public/site-info` 只承担最小公开 branding，不要膨胀成公开配置总接口。
2. 登录页 branding 获取失败必须 fail-open，不影响登录主流程。
3. 登录页的 API 请求必须考虑 base-path 场景，不能依赖挂载时序偶然成功。
4. 若调整 footer 策略，必须同时检查 `/login` 是否出现重复品牌信息。

### 5.3 修改 `my-usage` 模型语义时

1. 展示、筛选、聚合、模型下拉、统计摘要必须保持同一语义。
2. 只要 UI 选择“原始模型优先”，SQL 就必须统一用 `COALESCE(originalModel, model)`。
3. message_request 与 usage_ledger 两条路径必须同步修改，不能只改一边。

### 5.4 修改 VIP 告警时

1. DB enum、schema、repository、action、UI、i18n 必须全链路同步。
2. `NotificationJobType` 与 `WebhookNotificationType` 的映射必须同步修改。
3. 新增模板字段时，必须同步更新：
   - `defaults.ts`
   - `placeholders.ts`
   - `buildTemplateVariables`
   - test message 与模板测试
4. 默认模板字段必须忠实反映 payload 语义；不要把 provider 字段包装成不存在的 key 字段。
5. 如果调整去重粒度或时间窗，必须同时更新文档。

### 5.5 修改迁移时

1. 当前 `main` 上的新增迁移编号是 `0083`，不要照搬旧分支的 `0081`。
2. 对可能在多环境漂移的 enum / column 迁移，优先保持幂等。
3. 验收不能只看“本地迁移成功”，还要考虑重复执行和半漂移环境。

---

## 6. 常见排查清单

### 6.1 页面仍请求 `proxy/4000/_next/static/...`

优先检查：

1. `next.config.ts` 是否使用了 `PORT || "3000"`
2. 是否重新 build
3. 运行实例是否真的部署了新构建
4. `VSCODE_PROXY_URI` / `vscode_proxy_uri` 是否仍带旧端口

### 6.2 登录页站点标题不显示或又出现重复 footer

检查：

1. `/api/public/site-info` 是否返回有效 `siteTitle`
2. 登录页是否使用 base-path 感知的 `apiFetch`
3. `FooterWrapper` 是否仍挂在根 layout 中
4. 当前路径是否确实以 `/login` 结尾

### 6.3 `my-usage` 模型看起来不像用户请求的模型

检查：

1. 数据库记录是否带 `originalModel`
2. repository 层 model filter / distinct model 是否已统一为 `COALESCE(...)`
3. summary breakdown 是否仍按同一语义聚合

### 6.4 VIP 提醒不触发

检查：

1. 命中的 provider `groupTag` 是否包含 `vip`
2. Redis 中 VIP 提醒开关是否为开启状态；未配置时默认开启
3. 是否存在启用状态的 `vip_group_usage` binding
4. Redis 去重 key 是否在当前 `cooldownSeconds` 窗口内命中
5. 去重 key 是否命中了同一 `providerId + sessionId`

### 6.5 `.../proxy/3000/zh-CN` 反复请求自己

优先检查：

1. 线上实例是否已部署到包含 bare-locale 修复的新代码
2. 响应体是否仍然包含：
   - `var targetPath = ".../proxy/3000/zh-CN"`
   - `window.location.replace(fullPath)`
3. `src/proxy.ts` 中 `extractWorkspaceAppPath()` 是否仍错误排除了 bare locale root
4. 用 `.../proxy/3000/zh-CN/dashboard` 对比验证 dashboard 本身是否正常

---

## 7. 结论

当前 `main` 上这组实现的本质成果可以概括为 6 项：

- SII 代理路径 canonicalization 继续收敛，referer 恢复边界更清晰
- 构建时与运行时默认代理端口统一为 `3000`
- 登录 branding 通过最小公开接口获取，并隐藏公共 footer
- 登录页首屏 API 请求改为 base-path 感知，减少 branding / version 的挂载竞态
- `my-usage` / usage logs 改为真正闭环的“原始模型优先”语义
- `vip_group_usage` 完成从 Redis 配置到 UI 到 webhook 的全链路接入，并修正了默认模板字段语义

此外，本轮又补修了一条对 live 行为影响很大的路径问题：

- workspace bare-locale 根路径恢复为正确的登录 / dashboard 跳转语义，不再生成自循环跳转页

后续维护时，请把这三类一致性作为最高优先级约束：

- 路径 canonicalization 一致性
- `originalModel` 展示 / 筛选 / 聚合语义一致性
- notification 类型与模板字段的全链路一致性
