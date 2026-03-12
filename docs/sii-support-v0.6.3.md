# SII Support 与登录 Branding 实现说明（v0.6.3）

本文档用于记录 `v0.6.3` 最近两次提交合并后的关键能力：
- SII Notebook / VSCode 深层代理前缀支持的继续收敛
- 默认代理端口从 `4000` 统一为 `3000`
- 登录页公开站点标题与 footer 行为调整
- `my-usage` / usage logs 对原始模型名（`originalModel`）的显示与聚合修正
- VIP 高成本分组使用提醒（`vip_group_usage`）的全链路实现

重点是“机制、边界与后续维护规则”，不是逐文件罗列所有 diff。

目标读者：
- 后续版本维护者
- 需要让 AI 快速接手并继续迭代该能力的开发者

提交参考：
- source commit: `180a3cad`
- source commit: `8eb3014f`
- squashed commit: 当前 `0.6.3` 分支最新提交（请以 `git log -1` 为准）

---

## 1. 背景与问题定义

### 1.1 SII Notebook / VSCode 深层代理前缀

在 SII Notebook 网关下，应用实际运行路径通常不是根路径，而是类似：

`/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/3000`

旧问题主要有四类：
- canonical workspace path 被污染成带前置 `/proxy/<port>` 的路径
- `/_next/static/*` 静态资源前缀回退到错误端口，导致 404 / 500
- referer 恢复逻辑可能把“更丰富的 workspace path”降级成短前缀
- 外部 307 被上层网关改写后，进一步放大污染路径或循环跳转

这次合并后的版本，除了保留上一轮 SII canonicalization 方案，还进一步统一了默认端口为 `3000`，目的是让：
- `assetPrefix`
- env base path canonicalization
- 测试样例与 referer 恢复

都围绕同一端口语义工作，避免线上仍继续请求 `proxy/4000/_next/static/...`。

### 1.2 登录页 branding 与公共 footer

登录页在未登录态也需要展示系统站点标题，但不应该依赖需要后台权限或返回过重数据的接口。

同时，登录页本身已有明确的品牌展示区域，如果全站公共 footer 继续出现，会造成：
- branding 重复
- 版本 / 站点标题重复
- 登录页视觉噪音增加

### 1.3 my-usage 模型显示语义

对于发生模型重定向的请求，用户在 `my-usage` 和 usage logs 里更关心“原始请求模型”而不是“最终转发模型”。

如果聚合与展示只使用 `model`：
- 用户会误以为自己直接请求了重定向后的模型
- model breakdown 会把同一业务模型拆散到多个 redirected model 名称上

因此这次修正将展示与聚合基准统一为：

`COALESCE(originalModel, model)`

### 1.4 VIP 高成本分组提醒

当实际命中的 provider `groupTag` 包含 `vip` 时，需要发出请求级提醒，用于：
- 高成本线路审计
- 快速发现误用 VIP 路由
- 结合 webhook 体系做实时通知与测试发送

要求：
- 可配置开关
- 接入现有 target + binding 体系
- 有 5 分钟去重，避免刷屏
- 支持模板变量和测试消息

---

## 2. 总体设计

### 2.1 路径与静态资源

路径支持继续采用“三层协同”：
- 服务端 `src/proxy.ts` 负责 canonicalization、污染路径收敛、referer 恢复边界控制
- 构建时 `next.config.ts` 负责 `assetPrefix`
- 前端 `base-path` / redirect 体系负责浏览器侧补前缀与入口跳转

这次 `v0.6.3` 的新增点不是推翻原方案，而是补足两个关键收口：
- 服务端 env base path 默认端口统一成 `3000`
- 构建时 `assetPrefix` 默认端口统一成 `3000`

### 2.2 登录 branding

登录页通过独立的公开接口获取最小化 branding 信息：
- `GET /api/public/site-info`

并通过路由级包装组件隐藏全站公共 footer：
- `src/components/customs/footer-wrapper.tsx`

### 2.3 my-usage / usage logs 模型语义

模型展示和聚合统一按“原始模型优先”：
- 列表展示优先 `originalModel`
- breakdown 聚合按 `COALESCE(originalModel, model)`
- 模型筛选与建议也按同一语义工作

### 2.4 VIP 使用提醒

VIP 提醒仍遵循“请求链路触发 -> 队列 -> webhook 模板”的全链路：
- 触发点在 proxy forwarder
- 去重与启停在 notifier
- 最终通过 notification queue 和 webhook template 输出

---

## 3. 关键实现细节

### 3.1 `src/proxy.ts`：继续收敛 referer 恢复与 canonicalization

这次与上一轮 SII 修复相比，最关键的收敛点有两个。

第一，env base path 默认端口改为 `3000`：
- `getEnvProxyBasePath()` 中 `process.env.PORT || "3000"`

第二，referer 恢复只允许“更丰富 base path”向“更短路径”恢复，不允许反向 downgrade：
- `shouldRecoverFromRefererBase(recoverPath, refererBasePath)`
- 只有 `refererSegments > currentSegments` 才允许恢复

这样做的目的很明确：
- 如果当前路径已经是 canonical workspace path，就不应再被短 referer base 覆盖
- 对 `/proxy/3000/zh-CN/...` 这类“缺失 ws 中段”的路径，才允许用 richer referer 进行恢复

同时，`reprocessWithCanonicalEnvPath()` 继续坚持“进程内重处理”而不是外部 307：
- clone request
- 递归调用 `proxyHandler`
- 给响应补 `x-cch-proxy-rev`

这样可以减少上层 Notebook 网关改写 `Location` 带来的污染路径回流。

### 3.2 `next.config.ts`：`assetPrefix` 与默认端口统一为 `3000`

`next.config.ts` 的 `getAssetPrefix()` 现在与服务端同口径：
- 读取 `VSCODE_PROXY_URI` / `vscode_proxy_uri`
- 使用 `process.env.PORT || "3000"` 替换 `{{port}}`
- 再做 `collapseDuplicatedLeadingProxyPrefix()`

这一点直接决定：
- 页面里生成的 `/_next/*` 静态资源前缀
- 线上是否还会继续回到 `proxy/4000/_next/static/...`

因此 `src/proxy.ts` 和 `next.config.ts` 必须同步维护，不能只改一处。

### 3.3 路径污染清洗：登录重定向安全也要同口径

`src/app/[locale]/login/redirect-safety.ts` 中：
- `sanitizeRedirectPath()`
- `collapseDuplicatedLeadingProxyPrefix()`

会在 open redirect 防护之外，再把登录后的 `from` 参数做前缀污染清洗。

本次对应测试也一起改为 `3000` 语义：
- `tests/unit/auth/login-redirect-safety.test.ts`
- `tests/unit/proxy/proxy-env-base-path.test.ts`
- `tests/unit/proxy/proxy-auth-cookie-passthrough.test.ts`
- `tests/unit/lib/base-path-dynamic.test.ts`

这保证了：
- 登录链路
- referer 恢复链路
- base path 计算链路

都围绕同一个 canonical 端口工作。

### 3.4 登录页 branding：最小公开接口 + 登录页隐藏全站 footer

#### 公开站点标题接口

文件：
- `src/app/api/public/site-info/route.ts`

行为：
- 内部读取 `getSystemSettings()`
- 对外只返回 `{ siteTitle }`
- 失败时回退 `"Claude Code Hub"`

作用：
- 登录页无需依赖后台 action 或完整系统设置接口
- 未登录状态也能安全拿到 branding

#### 登录页使用方式

文件：
- `src/app/[locale]/login/page.tsx`

行为：
- 默认标题 `DEFAULT_SITE_TITLE = "Claude Code Hub"`
- `useEffect` 中请求 `/api/public/site-info`
- 若返回 `siteTitle` 且非空字符串，则替换页面品牌文案

边界：
- branding 获取失败不影响登录主流程
- 登录提交、错误提示、跳转逻辑与 branding 解耦

#### 登录页隐藏公共 footer

文件：
- `src/components/customs/footer-wrapper.tsx`

行为：
- `usePathname()`
- 若当前路径 `endsWith("/login")`，直接返回 `null`

这样可以保证：
- 登录页只展示自己的品牌区块
- 根 layout 仍保留统一 footer 挂载方式
- 不需要为登录页单独拆一套 layout 结构

### 3.5 `my-usage` / usage logs：原始模型优先

#### `my-usage` breakdown 聚合

文件：
- `src/actions/my-usage.ts`

关键变更：
- `getMyStatsSummary()` 的 model breakdown 使用
  `COALESCE(messageRequest.originalModel, messageRequest.model)`

这会同时影响：
- `keyModelBreakdown`
- `userModelBreakdown`

从而避免重定向后模型名把同一业务模型拆散。

#### usage logs 与筛选语义

文件：
- `src/repository/usage-logs.ts`

关键变更：
- `UsageLogRow` 明确保留 `originalModel`
- model filter 优先匹配 `COALESCE(originalModel, model)`
- model suggestion / distinct model 列表也按同一口径

结果是：
- 列表展示和筛选语义保持一致
- API 返回给前端的 `originalModel` 可直接用于 UI 侧“原始模型优先显示”

### 3.6 VIP 使用提醒全链路

#### 触发点

文件：
- `src/app/v1/_lib/proxy/forwarder.ts`

行为：
- 请求成功选中 provider 后，拆分 `currentProvider.groupTag`
- 做 `trim + lowercase`
- 若包含 `vip`，异步 `import("@/lib/notification/notifier")`
- 调用 `sendVipGroupUsageAlert(...)`

这是非阻塞触发：
- 不影响主请求返回
- 通知失败不会把正常请求打成失败

#### 去重与启停

文件：
- `src/lib/notification/notifier.ts`

行为：
- 要求 `settings.enabled === true`
- 要求 `settings.vipGroupUsageEnabled === true`
- Redis 去重 key 为 `vip-group-usage-alert:${providerId}`
- TTL 为 300 秒
- 通过 `getEnabledBindingsByType("vip_group_usage")` 查绑定

当前去重粒度是：
- `providerId` 级别
- 不是 user+provider 或 session 级别

这是设计选择，后续如果改粒度，文档也必须一起更新。

#### 队列与模板

相关文件：
- `src/lib/notification/notification-queue.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`
- `src/lib/webhook/templates/defaults.ts`
- `src/lib/webhook/templates/placeholders.ts`
- `src/lib/webhook/templates/test-messages.ts`
- `src/lib/webhook/types.ts`

说明：
- job type 与 webhook notification type 已全链路接通
- 模板变量覆盖用户、provider、groupTag、model、session 等关键信息
- 设置页测试发送也能构造对应 payload

### 3.7 数据库与设置链路

VIP 提醒对应的 schema / setting 也已经打通：

文件：
- `drizzle/0081_petite_slapstick.sql`
- `src/drizzle/schema.ts`
- `src/repository/notifications.ts`
- `src/repository/notification-bindings.ts`
- `src/actions/notification-bindings.ts`
- `src/actions/webhook-targets.ts`
- `src/app/api/actions/[...route]/route.ts`
- `src/app/[locale]/settings/notifications/_lib/hooks.ts`
- `src/app/[locale]/settings/notifications/_lib/schemas.ts`
- `src/app/[locale]/settings/notifications/_components/notification-type-card.tsx`
- `src/app/[locale]/settings/notifications/_components/test-webhook-button.tsx`
- `messages/*/settings/notifications.json`

核心点：
- `notification_type` 新增 `vip_group_usage`
- `notification_settings` 新增 `vip_group_usage_enabled`
- 前后端枚举、schema、卡片 UI、测试发送、i18n 一并同步

---

## 4. 测试与验证

本次改动最值得优先关注的测试集：

路径与端口相关：
- `tests/unit/proxy/proxy-env-base-path.test.ts`
- `tests/unit/proxy/proxy-auth-cookie-passthrough.test.ts`
- `tests/unit/auth/login-redirect-safety.test.ts`
- `tests/unit/lib/base-path-dynamic.test.ts`

VIP 告警相关：
- `tests/unit/webhook/notifier-vip-group-usage.test.ts`
- `tests/unit/webhook/templates/placeholders.test.ts`
- `tests/unit/webhook/templates/templates.test.ts`

my-usage 原始模型相关：
- `tests/api/my-usage-readonly.test.ts`
- `tests/unit/actions/my-usage-original-model-display.test.ts`

本轮实际做过的验证：
- `bun run build` 通过
- `bun run typecheck` 通过
- 上述路径相关定向测试通过

需要注意：
- 仓库全量 `bun run test` 在当前基线上仍存在少量既有失败，和这次端口 / 文档改动不直接相关
- 此类代理路径问题，最终仍应以真实 ws URL 上的 live 行为为准，而不是只看单测

---

## 5. 后续修改必须遵守的规则

### 5.1 修改 SII 路径逻辑时

1. `src/proxy.ts` 与 `next.config.ts` 的默认端口与前缀算法必须同步。
2. 不要轻易把进程内重处理改回外部 307。
3. referer 恢复必须坚持“只允许 richer base path 恢复 poorer path”，不要反向 downgrade。
4. 新增路径规则后，至少补三类测试：
   - 污染路径输入
   - canonical path 不降级
   - 不返回外部 `Location`

### 5.2 修改登录 branding 时

1. `api/public/site-info` 只承担公开 branding，不要逐步膨胀成通用公开配置接口。
2. 登录页 branding 获取失败时必须 fail-open，不影响登录主流程。
3. 若重新调整 footer 策略，必须同时检查 `/login` 是否出现重复品牌信息。

### 5.3 修改 my-usage 模型显示时

1. 聚合、筛选、建议、列表展示必须保持同一语义。
2. 如果展示优先 `originalModel`，SQL 聚合也必须使用 `COALESCE(originalModel, model)`。
3. 不要让“列表显示原始模型”但“聚合按最终模型”的分裂语义再次出现。

### 5.4 修改 VIP 告警时

1. DB enum、schema、repository、action、UI、i18n 必须全链路同步。
2. `NotificationJobType` 与 `WebhookNotificationType` 的映射必须同步修改。
3. 新增模板字段时，必须同步更新：
   - `defaults.ts`
   - `placeholders.ts`
   - `buildTemplateVariables`
4. 若调整去重粒度或时间窗，必须在文档里明确写出新规则。

---

## 6. 常见排查清单

### 6.1 页面仍请求 `proxy/4000/_next/static/...`

优先检查：
1. `next.config.ts` 是否已使用 `PORT || "3000"`
2. 是否重新执行过 `bun run build`
3. 运行中的实例是否确实已更新到新构建
4. `VSCODE_PROXY_URI` / `vscode_proxy_uri` 是否仍残留旧端口语义

### 6.2 登录页站点标题不显示或又出现重复 footer

检查：
1. `/api/public/site-info` 是否返回了有效 `siteTitle`
2. 登录页 fetch 是否成功
3. `FooterWrapper` 是否仍在根 layout 中生效
4. 当前路径是否确实以 `/login` 结尾

### 6.3 my-usage 模型看起来“不像我请求的模型”

检查：
1. 数据库里该条请求是否有 `originalModel`
2. `usage-logs` 查询是否走了 `COALESCE(originalModel, model)`
3. `my-usage` summary breakdown 是否仍按同口径聚合

### 6.4 VIP 提醒不触发

检查：
1. 命中的 provider `groupTag` 是否包含 `vip`
2. `notification_settings.enabled` 与 `vip_group_usage_enabled` 是否都开启
3. 是否存在启用状态的 `vip_group_usage` binding
4. Redis 去重 key 是否在 5 分钟窗口内命中

---

## 7. 结论

这两次提交合并后的本质成果有五项：
- SII 代理路径 canonicalization 继续收敛，尤其是 referer 恢复边界更清晰
- 构建时与运行时默认代理端口统一为 `3000`
- 登录页 branding 通过最小公开接口获取，并隐藏全站公共 footer
- `my-usage` / usage logs 改为“原始模型优先”语义
- VIP 分组使用提醒完成从 DB 到 UI 到 webhook 的全链路接入

后续迭代时，请把“路径归一化一致性”、“展示语义一致性”和“通知类型全链路一致性”作为最高优先级约束。
