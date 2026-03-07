# SII Support 实现说明（v0.6.1）

本文档用于记录 `v0.6.1` 期间与 SII Notebook/VSCode 代理路径相关的关键改动，以及 VIP 高成本分组使用提醒（`vip_group_usage`）的完整实现链路。
重点是“路径支持机制与边界”，不是逐文件复述该提交的全部变更。

目标读者：
- 后续版本维护者
- 需要让 AI 快速接手并继续迭代该能力的开发者

提交参考：
- commit: `5f2db510`
- message: `feat: sync SII proxy base-path fixes and VIP usage alert hardening`

---

## 1. 背景与问题定义

### 1.1 VSCode 前缀支持问题（SII Notebook 场景）

在 SII Notebook 网关下，应用常运行在动态路径前缀中，例如：

`/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/4000`

旧问题表现：
- 访问 canonical URL 时被重定向为污染路径，出现 `Location: /proxy/4000/ws-...` 形式。
- 前端可能继续拼接错误前缀，导致 404 或循环跳转。
- 外部 307 在网关改写后会放大该问题。

典型错误链路：
- canonical: `/ws-.../proxy/4000/dashboard`
- 被错误改写为: `/proxy/4000/ws-.../proxy/4000/dashboard`

### 1.2 VIP 高成本分组提醒需求

当请求实际命中 `groupTag` 包含 `vip` 的供应商时，需要触发实时提醒（请求级），用于高成本线路使用监控和审计。

要求：
- 可开关
- 支持多目标 webhook 绑定体系
- 限流去重（避免刷屏）
- 支持模板变量与测试发送

---

## 2. VSCode 前缀支持：总体设计

实现不是单点修复，而是“服务端 canonicalization + 前端自动补前缀 + 登录/重定向安全”三层兜底。

### 2.1 服务端（Middleware）职责

文件：`src/proxy.ts`

核心职责：
- 在 middleware 层识别并归一化污染路径。
- 避免对 workspace path 进行错误的 env base path 降级。
- 尽量使用“进程内重处理”（递归调用 `proxyHandler`）替代外部 307。
- 保持关键分支可观测（便于线上验证当前逻辑是否生效）。

### 2.2 前端职责

文件：
- `src/lib/utils/base-path.ts`
- `src/lib/utils/fetch-interceptor.ts`
- `src/lib/utils/navigation-interceptor.ts`
- `src/components/proxy-fetch-initializer.tsx`
- `src/components/client-redirect.tsx`
- `src/app/[locale]/layout.tsx`

核心职责：
- 动态从 `window.location.pathname` 计算 base path（支持 ws 前缀、污染路径恢复）。
- 拦截 `fetch` 与导航，自动补全前缀。
- server component 无法可靠感知动态前缀时，使用 client redirect。

### 2.3 构建时静态资源职责

文件：`next.config.ts`

核心职责：
- 通过 `VSCODE_PROXY_URI` / `vscode_proxy_uri` 计算 `assetPrefix`，确保 `/_next/*` 静态资源在代理前缀下可访问。
- 同样执行前缀污染收敛（`collapseDuplicatedLeadingProxyPrefix`）。

---

## 3. VSCode 前缀支持：关键实现细节

## 3.0 路径类型支持矩阵（最重要）

下表是当前路径支持的“输入模式 -> 处理策略 -> 目标形态”。

| 输入模式 | 示例 | 处理入口 | 策略 | 目标形态 |
| --- | --- | --- | --- | --- |
| canonical workspace path | `/ws-.../proxy/4000/zh-CN/dashboard` | `proxyHandler` | 放行或局部 rewrite | 保持不变 |
| polluted leading proxy | `/proxy/4000/ws-.../proxy/4000/zh-CN` | hard guard + `collapseDuplicatedLeadingProxyPrefix` | 去掉错误 leading `/proxy/4000`，进程内重处理 | `/ws-.../proxy/4000/zh-CN` |
| locale-before-workspace | `/zh-CN/ws-.../proxy/4000/dashboard` | `normalizeLocaleLeadingWorkspacePath` | locale 重排到 workspace 后 | `/ws-.../proxy/4000/zh-CN/dashboard` |
| proxy+locale-before-workspace | `/proxy/4000/zh-CN/ws-.../proxy/4000/dashboard` | `stripPollutedPrefixBeforeWorkspace` + `normalizeWorkspacePathWithLocale` | 去污染前缀 + locale 归位 | `/ws-.../proxy/4000/zh-CN/dashboard` |
| missing ws middle segment | `/proxy/4000/zh-CN/login` | `maybeCanonicalizePathWithEnvProxyBase` | 用 env canonical base 补全中段，进程内重处理 | `/ws-.../proxy/4000/zh-CN/login` |
| root `_next` asset lost prefix | `/_next/static/...` | `maybeCanonicalizePathWithEnvProxyBase` + `_next` rewrite | 先补全 canonical base，再回写 root `_next` | 正常命中静态资源 |
| prefixed `_next` asset | `/ws-.../proxy/4000/_next/static/...` | `extractNextInternalPath` | rewrite 到 `/_next/static/...` | root `_next` |
| referer-only recoverable path | `/zh-CN/login` 且 referer 带 ws base | `maybeRestoreProxyPrefixFromReferer` | 仅在 referer base 更“丰富”时恢复 | 拼回 richer workspace base |

后续改动优先遵守“同类路径保持同一入口处理”，避免同一类场景分散在多个分支出现冲突。

---

## 3.1 路径归一化核心函数（服务端/前端一致）

重复出现的核心算法（server + client + redirect html 内联脚本）：
- `collapseDuplicatedLeadingProxyPrefix(path)`
- `normalizeWorkspacePathWithLocale(pathname, locale)`
- `stripPollutedPrefixBeforeWorkspace(pathname)`
- `normalizeLocaleLeadingWorkspacePath(pathname)`
- `normalizeRedirectPath(pathWithOptionalSearch)`

归一化目标：
- 去掉错误的 leading `/proxy/<port>`，尤其当后续真实首段是 `/ws-...` 时。
- 把 `/<locale>/ws-...` 重排成 `/ws-.../<locale>/...`。
- 把 `/proxy/<port>/<locale>/ws-...` 同样重排为 canonical 顺序。

Canonical 形态（示意）：
- `/ws-.../project-.../user-.../vscode/.../proxy/4000/zh-CN/dashboard`

---

## 3.2 `proxy.ts` 请求处理顺序（非常关键）

入口函数：`proxyHandler(request)`

处理顺序（简化）：
1. **Hard guard**：若命中 `^/proxy/\d+/ws-...`，先 `collapse`，然后进程内重处理。
2. 提取 `workspaceAppPath`（从 ws 全路径抽取 app 路径），按条件 rewrite 或进程内重处理。
3. 执行 `maybeCanonicalizePathWithEnvProxyBase`（仅在非 ws path 时）。
4. `_next` 内部资源抽取与 rewrite。
5. `normalizeDuplicatedProxyPrefixPath`（进程内重处理，不发外部 307）。
6. `maybeRestoreProxyPrefixFromReferer`（仅在需要时用 referer 恢复缺失中段）。
7. API 代理路径放行。
8. 静态资源路径放行。
9. intl middleware + 公共路径 + 鉴权 + 相对重定向。

关键点：
- 多处分支把“应该 redirect 的修复”替换为“clone request + 递归调用 proxyHandler”，降低网关改写 `Location` 的风险。
- `REQUEST_META` 记录：
  - `originalPathWithSearch`
  - `skipRefererRecovery`
  - `skipEnvCanonicalization`
  防止循环恢复和相互污染。

---

## 3.2.1 `proxy.ts` 关键分支详解（按代码语义）

1. hard guard（`/^/proxy/\d+/ws-/`）  
目的：第一时间消掉“前置污染前缀”，防止后续分支建立在错误基线之上。

2. `extractWorkspaceAppPath`  
目的：对于 workspace 前缀下的 app 路径，提取实际 app suffix（例如 `/<locale>/...`），避免把 ws 前缀带入 app 路由匹配。

3. `maybeCanonicalizePathWithEnvProxyBase`  
目的：修复“丢失 ws 中段”的路径。  
边界：只在非 ws path 下启用，避免短 env base 反向覆盖 canonical ws path。

4. `_next` 资源 rewrite  
目的：让 `/_next` 始终按 Next 内部规则解析，避免被业务路由/locale 逻辑污染。

5. `normalizeDuplicatedProxyPrefixPath`  
目的：处理 `/proxy/<port>/.../proxy/<port>/...` 重复前缀路径。  
策略：进程内重处理，避免外部跳转循环。

6. referer 恢复（`maybeRestoreProxyPrefixFromReferer`）  
目的：兜底恢复缺失前缀。  
边界：只在 referer base path 分段更多（更丰富）时才恢复，不做 downgrade。

7. intl + auth + relative redirect  
目的：保留原国际化与登录流程，但重定向目标始终先做路径归一化。

---

## 3.3 为什么要避免外部 307（核心经验）

问题不是 Next.js 单方逻辑，而是“外部网关可能改写 Location”。

如果我们返回 307:
- 目标 `Location` 可能被网关重写成 ` /proxy/<port>/ws-... `
- 客户端再跟随新 URL，污染路径持续存在甚至循环

改法：
- 尽量在 middleware 内部完成 canonicalization，再继续流程。
- 仅在确实需要（如 referer 恢复）时返回 307，并且目标路径先经过归一化函数。

---

## 3.4 env base path canonicalization 的边界策略

函数：`maybeCanonicalizePathWithEnvProxyBase`

输入来源：
- `VSCODE_PROXY_URI` / `vscode_proxy_uri`
- 支持 `{{port}}` 替换（默认 `PORT` 或 `4000`）

关键规则：
- 如果请求路径已经包含 workspace segment（`/ws-...`），**不**使用 env base 强制改写，避免短前缀 `/proxy/4000` 降级 canonical ws path。
- 只对 root app path / `_next` / `proxy+locale` 丢失中段场景执行恢复。
- 如发现请求中嵌入了 envBasePath（但前面有垃圾前缀），会截断到嵌入起点后进程内重处理。

---

## 3.5 前端 base path 动态计算与拦截

### `base-path.ts`

关键逻辑：
- 基于 `window.location.pathname` 计算，且缓存 `cachedPathname`，路径变化时自动重算（避免 stale basePath）。
- 支持从污染路径推导 canonical ws base path。
- `getBasePath()`、`getApiBasePath()`、`withBasePath()`、`apiUrl()`、`apiFetch()`。
- 通过 `cachedPathname` 避免跨页面污染：path 变化时强制重算，不沿用旧短前缀。
- 对 locale 根入口（如 `.../proxy/4000/zh-CN`）不依赖“重新拼整条绝对地址”来跳 `/dashboard`，而是优先基于当前 URL 做 locale-root 相对跳转，避免某些 Notebook/WebView 容器反复重新拉起根入口。

### `fetch-interceptor.ts`

`patchFetchForProxy()` 对同源绝对路径自动补 basePath：
- 仅处理 `"/..."`、同源 URL、Request 对象同源 URL。
- 不处理 `/_next/*`、已有 base path、包含 `/proxy/` 的路径。
- 目的不是“盲目拼前缀”，而是“只补缺失前缀”，避免二次污染。

### `navigation-interceptor.ts`

`patchNavigationForProxy()`：
- capture 阶段拦截 `<a>` 点击并改写跳转目标。
- patch `history.pushState / replaceState`。
- 同样跳过外链、`/_next`、已带 basePath、含 `/proxy/` 的路径。
- 对 Next.js/next-intl 兼容方式：不直接改写 DOM 上 href，而是拦截行为层。

### 初始化挂载点

`src/app/[locale]/layout.tsx` 注入 `ProxyFetchInitializer`，全站生效。

---

## 3.6 client redirect 替代 server redirect

文件：
- `src/components/client-redirect.tsx`
- 使用处：`src/app/[locale]/page.tsx`, `src/app/[locale]/dashboard/layout.tsx`, `src/app/[locale]/dashboard/quotas/page.tsx`

原因：
- server component redirect 很难携带运行时动态 ws 前缀。
- client 端可通过 `getBasePath()` 拼出完整目标 URL。
- 这一点对 `/`, `/dashboard layout`, `/dashboard/quotas` 等入口尤为关键。

---

## 3.7 登录重定向安全与前缀污染清洗

文件：`src/app/[locale]/login/redirect-safety.ts`

`sanitizeRedirectPath(from)` 在原有 open redirect 防护基础上新增：
- 对 `from` 做 `collapseDuplicatedLeadingProxyPrefix` 清洗。
- 既防外链注入，也避免登录后跳入污染路径。

## 3.7.1 登录页 branding 与公开站点信息接口

文件：
- `src/app/[locale]/login/page.tsx`
- `src/app/api/public/site-info/route.ts`
- `src/components/customs/footer-wrapper.tsx`
- `src/app/[locale]/layout.tsx`

补充目的：
- 登录页在未登录状态下也需要拿到自定义 `siteTitle`，但不应依赖需要鉴权或返回内容过重的后台设置接口。
- 登录页底部不再额外重复展示站点标题与版本信息，避免和主体 branding 重复。
- 全站公共 footer 在 `/login` 路由下隐藏，减少登录页视觉干扰。

实现方式：
- 登录页改为请求公开接口 `GET /api/public/site-info`，仅返回 `siteTitle`。
- 接口内部仍读取系统设置，但对外只暴露最小字段，异常时回退到默认标题 `Claude Code Hub`。
- `FooterWrapper` 基于 `usePathname()` 在 `pathname.endsWith("/login")` 时直接不渲染 footer。
- 根 layout 继续保留统一 footer 挂载点，但通过包装组件在登录页做路由级隐藏。

边界：
- 该接口是 branding 辅助接口，不承担登录鉴权、版本信息或其他系统配置透出职责。
- 登录页 branding 取值失败时只回退默认标题，不影响登录流程本身。

---

## 3.8 可观察性建议（不绑定具体调试值）

建议保留一种轻量可观测手段（如响应头标记）用于排查：
- 当前请求是否命中了新版 middleware 分支
- 当前实例是否已部署最新路径逻辑

注意：
- 具体标记值（如日期版号）属于运行期调试信息，不应成为功能文档主线。

---

## 3.9 `/v1/messages` 自动补 `beta=true`（Anthropic）

这项逻辑不属于“路径归一化”，但属于本次 `0.6.1` 最新提交中的代理行为增强，后续改动时需要知晓。

文件：
- `src/app/v1/_lib/proxy/forwarder.ts`

函数：
- `enforceAnthropicMessagesBetaQuery(session, provider, proxyUrl)`

触发条件（同时满足）：
1. 供应商类型是 `claude` 或 `claude-auth`
2. 请求路径严格等于 `/v1/messages`

行为：
- 如果 query 中 `beta` 不是 `true`，则强制改写为 `beta=true`
- 若原本已有其他 query 参数，会保留并仅覆盖 `beta`
- `/v1/messages/count_tokens` 不在此规则内

目的：
- 降低上游 Anthropic Messages API 在不同客户端参数行为下的不一致风险
- 统一消息请求默认行为，减少因调用侧遗漏导致的问题

测试：
- `tests/unit/proxy/proxy-forwarder.test.ts` 中包含：
  - “为 Anthropic /v1/messages 自动追加 beta=true”
  - “保留已有查询参数并强制 beta=true”

---

## 4. VIP 高成本分组提醒：总体设计

## 4.1 触发点（请求链路）

文件：`src/app/v1/_lib/proxy/forwarder.ts`

当某次请求成功命中供应商后：
- 从 `currentProvider.groupTag` 拆分 `,` 并 `trim + lowercase`
- 若包含 `vip`：
  - 组装 `VipGroupUsageData`
  - 异步调用 `sendVipGroupUsageAlert`

触发时机：
- 请求成功后
- 非阻塞（`void import(...).then(...)`），不影响主请求返回

---

## 4.2 通知发送逻辑与去重

文件：`src/lib/notification/notifier.ts`

函数：`sendVipGroupUsageAlert(data)`

执行流程：
1. 读取通知设置 `getNotificationSettings()`
2. 要求：
   - `settings.enabled === true`
   - `settings.vipGroupUsageEnabled === true`
3. Redis 去重（如可用）：
   - key: `vip-group-usage-alert:${providerId}`
   - TTL: 300 秒
4. 查绑定：
   - `getEnabledBindingsByType("vip_group_usage")`
5. 每个 binding 入队：
   - `addNotificationJobForTarget("vip-group-usage", targetId, bindingId, data)`
6. 写去重 key（EX 300）

当前去重粒度是 `providerId` 级别（不是 user+provider），这是设计选择，后续可按需调整。

---

## 4.3 队列消费与 webhook 模板

文件：`src/lib/notification/notification-queue.ts`

新增支持：
- `NotificationJobType` 包含 `"vip-group-usage"`
- `toWebhookNotificationType("vip-group-usage") -> "vip_group_usage"`
- switch 分支构建消息：
  - `buildVipGroupUsageMessage(data, timezone)`

---

## 4.4 数据结构、模板与占位符

文件：
- `src/lib/webhook/types.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`
- `src/lib/webhook/templates/defaults.ts`
- `src/lib/webhook/templates/placeholders.ts`
- `src/lib/webhook/templates/test-messages.ts`

新增数据类型：
- `VipGroupUsageData`

新增 notification type：
- `vip_group_usage`（webhook 维度）
- `vip-group-usage`（job type 维度）

默认模板字段：
- `{{user_id}}`, `{{user_name}}`
- `{{provider_id}}`, `{{provider_name}}`
- `{{provider_group_tag}}`, `{{key_group}}`
- `{{model}}`, `{{session_id}}`

---

## 4.5 配置端（API + Repository + UI）

### DB / Schema

文件：
- `drizzle/0078_talented_hobgoblin.sql`
- `src/drizzle/schema.ts`

变更：
- `notification_type` enum 增加 `vip_group_usage`
- `notification_settings` 增加 `vip_group_usage_enabled boolean not null default false`

### Repository

文件：
- `src/repository/notifications.ts`
- `src/repository/notification-bindings.ts`

变更：
- 设置结构体、默认值、更新字段支持 `vipGroupUsageEnabled`
- 绑定类型 union 增加 `"vip_group_usage"`

### Action/API

文件：
- `src/app/api/actions/[...route]/route.ts`
- `src/actions/notification-bindings.ts`
- `src/actions/webhook-targets.ts`

变更：
- API schema 增加 `vipGroupUsageEnabled`
- Webhook 通知类型枚举增加 `vip_group_usage`
- 测试发送数据 `buildTestData` 支持 vip payload

### 前端设置页

文件：
- `src/app/[locale]/settings/notifications/_lib/hooks.ts`
- `src/app/[locale]/settings/notifications/_lib/schemas.ts`
- `src/app/[locale]/settings/notifications/_components/notification-type-card.tsx`
- `src/app/[locale]/settings/notifications/_components/test-webhook-button.tsx`
- i18n: `messages/*/settings/notifications.json`

变更：
- 配置 state、类型枚举、卡片 UI、测试按钮都支持 `vip_group_usage`
- 国际化键新增 `notifications.vipGroupUsage.*`

---

## 5. 测试覆盖（建议优先跑）

VSCode 前缀相关：
- `tests/unit/proxy/proxy-env-base-path.test.ts`
- `tests/unit/proxy/proxy-auth-cookie-passthrough.test.ts`
- `tests/unit/auth/login-redirect-safety.test.ts`
- `tests/unit/lib/base-path-dynamic.test.ts`

VIP 告警相关：
- `tests/unit/webhook/notifier-vip-group-usage.test.ts`
- `tests/unit/webhook/templates/placeholders.test.ts`
- `tests/unit/webhook/templates/templates.test.ts`
- `tests/e2e/notification-settings.test.ts`（包含通知配置流程）

建议命令：
- `bun run test tests/unit/proxy/proxy-env-base-path.test.ts`
- `bun run test tests/unit/webhook/notifier-vip-group-usage.test.ts`

路径类回归最小集（发布前）：
1. polluted `/proxy/<port>/ws-...` 访问不再产生外部 `Location`
2. locale-before-workspace 与 proxy+locale-before-workspace 都能归一化到 canonical
3. workspace canonical path 不会被短前缀 env base downgrade
4. `/_next` 在 root/prefixed 两种请求下都能命中
5. 登录 `from` 参数污染路径可被清洗（不进入污染 loop）

---

## 6. 后续修改必须遵守的规则

## 6.1 修改 `proxy.ts` 时

1. 不要轻易把“进程内重处理”改回“外部 307”。
2. 路径规范化函数必须在 server/client/redirect-html 三处保持行为一致。
3. 新增路径规则后，至少补：
   - 污染路径输入 case
   - canonical 路径不降级 case
   - 不产生 `Location` 的断言（需要时）
4. 保留可观测信号（形式可变），但不要把调试值硬编码进设计文档。

## 6.2 修改 VIP 告警时

1. `NotificationJobType` 与 `WebhookNotificationType` 的映射必须同步。
2. DB enum + schema + repository + action + UI + i18n 必须全链路同步。
3. 任何新增模板字段都要同步：
   - `defaults.ts`
   - `placeholders.ts`
   - `buildTemplateVariables`
4. 变更去重策略时要明确写入文档（当前是 providerId 级别 5 分钟）。

---

## 7. 常见故障排查清单

### 7.1 访问仍被重定向到 `/proxy/<port>/ws-...`

检查：
1. 是否存在可观测信号表明请求命中了新 middleware 分支
2. 实际运行是否是最新构建（`bun run build` 后重新 `bun run start`）
3. 网关是否缓存旧响应或改写了 `Location`
4. `VSCODE_PROXY_URI` 是否配置异常（尤其是否带污染前缀）

### 7.2 前端跳转仍 404

检查：
1. `ProxyFetchInitializer` 是否在根 layout 挂载
2. 页面是否还在用 server-side redirect，而不是 `ClientRedirect`
3. `assetPrefix` 是否从 env 正确解析
4. `getBasePath()` 在该页面路径下的返回是否符合预期

### 7.3 VIP 提醒不触发

检查：
1. 命中供应商 `groupTag` 是否包含 `vip`（大小写/空格已处理）
2. `notification_settings.enabled` 与 `vip_group_usage_enabled` 是否都开启
3. `notification_target_bindings` 是否存在 `vip_group_usage` 且绑定目标启用
4. Redis 去重 key 是否命中（5 分钟窗口内会抑制）
5. 队列 worker/Redis 是否正常（任务是否成功消费）

---

## 8. 结论

本次改动本质上完成了两件事：
- **路径层面**：把 SII/VSCode 动态前缀问题从“依赖外部重定向”改为“内部规范化优先”，显著降低网关改写导致的污染路径循环。
- **通知层面**：把 VIP 分组调用提醒接入了现有多目标通知体系（配置、绑定、队列、模板、测试全链路打通）。

后续迭代时，请将“路径归一化一致性”和“通知类型全链路一致性”作为最高优先级约束。
