# SII Support、登录 Branding 与 Key Soft Block 实现说明（v0.6.8）

本文档记录当前 `0.6.8` 分支落地的、对齐 `0.6.7` 能力并适配当前 `main` 代码结构后的实现边界，覆盖 SII 路径、登录 branding、`originalModel` 语义、VIP 提醒与 Key Soft Block。

这不是简单照搬 `0.6.7` diff 的记录，而是当前代码基线上真实生效的机制说明，以及后续维护时必须继续遵守的约束。

当前文档聚焦 6 条主线：

- SII Notebook / VSCode 深层代理前缀支持继续收敛
- 默认代理端口统一为 `3000`
- 登录 branding 与公共 footer 调整
- `my-usage` / usage logs 的 `originalModel` 优先语义
- VIP 高成本分组提醒（`vip_group_usage`）全链路接入
- Key Soft Block：Redis 写入、Redis 回读、代理拦截与编辑回填闭环
- opencode 调用 Claude `/v1/messages` 时自动追加 `beta=true`，且不覆盖调用方显式提供的 `beta` 参数

另外，本文档也记录本轮一并收口的后续问题：

- `usage-logs` repository 层剩余 model filter / distinct-model 语义补齐
- 登录页 branding / version 首屏请求改为 base-path 感知，避免挂载时序竞态
- `vip_group_usage` 默认模板字段语义纠正，不再把 provider group 错标成 key group
- workspace bare-locale 根路径（`.../proxy/3000/zh-CN`）恢复成正确的登录 / 首页跳转语义，不再生成自循环跳转页
- `vip_group_usage` 枚举迁移按幂等方式生成，避免环境漂移时再次触发 `enum label already exists`
- Key 编辑入口再次打开时，soft block 开关与提示词可从 Redis 正确回填

目标读者：

- 后续版本维护者
- 需要继续维护代理路径 / branding / usage / notification 语义的开发者

---

## 1. 背景与问题定义

### 1.1 SII Notebook / VSCode 深层代理前缀

在 SII Notebook 网关下，应用真实访问路径通常不是根路径，而是类似：

`/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/3000`

历史问题主要集中在以下几类：

- canonical workspace path 被错误污染成前置 `/proxy/<port>` 的形式
- `/_next/static/*` 前缀回退到错误端口，导致静态资源 404 / 500
- referer 恢复逻辑可能把 richer workspace path 错降级成短路径
- 登录 `from` 参数中残留污染的 `/proxy/<port>` 前缀
- workspace bare-locale 根路径可能被错误生成为“跳回自己”的 HTML redirect，从而触发浏览器自循环

### 1.2 登录 branding 与公共 footer

登录页需要在未登录态展示站点标题，但不应该依赖后台权限接口或过重配置接口。

同时登录页本身已经有自己的品牌区块，全站公共 footer 若继续显示，会造成：

- branding 重复
- 标题 / 版本重复
- 登录页视觉噪音增加

此外，SII / Notebook base-path 场景下还存在一个运行时问题：

- 如果 branding 请求是裸 `fetch("/api/...")`
- 而 base-path fetch patch 又是在另一个 `useEffect` 中挂载

则首屏 branding / version 取数可能在 patch 生效前直接请求到根路径，表现为“偶发回退默认标题”。

### 1.3 `my-usage` / usage logs 的模型显示语义

发生模型重定向时，用户更关心“原始请求模型”，而不是最终转发模型。

因此展示、筛选、聚合都必须围绕：

`COALESCE(originalModel, model)`

如果只改某一层，会出现这些回归：

- 列表显示原始模型，但筛选仍按最终模型
- `my-usage` breakdown 看起来正确，但 usage logs distinct model 列表仍然是 redirected model
- `message_request` 路径和 `usage_ledger` 路径语义不一致

### 1.4 VIP 高成本分组提醒

当命中的 provider `groupTag` 包含 `vip` 时，需要发出请求级提醒，用于：

- 高成本线路审计
- 误用 VIP provider 的快速发现
- 结合 webhook target / binding / test message 做完整通知链路联调

要求：

- Redis 可配置开关，默认开启
- 接入现有 notification target + binding 体系
- Redis 可配置去重阈值，默认 300 秒
- 同一 `providerId + sessionId` 在去重窗口内只提醒一次
- 支持模板变量与测试消息
- 迁移必须能在半漂移环境重复执行，不因 enum 已存在而失败

### 1.5 Key Soft Block：临时限制而不是删 Key / 改 DB

当前 `0.6.8` 保持的临时限制方案：

- dashboard 编辑 Key 时把 `enabled + message` 写入 Redis
- 读取用户 / Key 列表时再从 Redis 回填 UI 展示与编辑默认值
- proxy `auth-guard` 与 `/v1/models` 共享同一份运行时限制配置
- 命中时统一返回 `401 user_disabled`

设计边界仍然是：

- 不改 Key 数据库 schema
- 不删除 Key 元数据
- 支持随时关闭限制并立即恢复正常请求

---

## 2. 总体设计

### 2.1 路径与静态资源

当前实现仍然是“三层协同”：

- 服务端 `src/proxy.ts` 负责 canonicalization、污染路径收敛、referer 恢复边界控制
- 构建时 `next.config.ts` 负责 `assetPrefix`
- 客户端 `base-path` / redirect / fetch / navigation 体系负责浏览器侧补前缀和入口跳转

本轮在 `0.6.8` 上除了延续 `0.6.7` 思路，还继续保持一个重要收口：

- workspace bare-locale 根路径要和普通 app 入口一样处理，不能落到“跳回自己”的相对跳转页

### 2.2 登录 branding

登录页通过最小公开接口获取 branding：

- `GET /api/public/site-info`

同时在根 layout 中：

- 挂载 `ProxyFetchInitializer`
- 用 `FooterWrapper` 对 `/login` 隐藏公共 footer

登录页请求直接走 base-path 感知的 `apiFetch(...)`，不再依赖挂载期 fetch patch 的时序。

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

实现特别强调：

- 模板字段必须忠实反映真实 payload
- 不能把 `providerGroupTag` 伪装成 `keyGroup`

### 2.5 Key Soft Block

Key soft block 现在是完整的 Redis-only 运行时链路：

- `src/lib/key-soft-block-store.ts` 负责 `cch:key-soft-block:${keyId}` 的读写
- dashboard 的新增 / 编辑 Key 入口都会提交 `softBlockEnabled` 与 `softBlockMessage`
- 用户列表、Key 列表和编辑弹窗重新打开时，会从 Redis 回读并回填当前状态
- `auth-guard` 与 `/v1/models` 保持一致拦截口径

---

## 3. 关键实现细节

### 3.1 `src/proxy.ts`：路径 canonicalization、referer 恢复与 bare-locale 根路径修正

- `getEnvProxyBasePath()` 统一使用 `process.env.PORT || "3000"`
- referer 恢复坚持“只允许 richer base path 恢复 poorer path”
- `reprocessWithCanonicalEnvPath()` 继续走 in-process reprocess，不回退到外部 307/302
- workspace bare-locale 根路径会被当成真实 app 入口处理

### 3.2 `next.config.ts`：`assetPrefix` 与 `3000` 端口统一

`getAssetPrefix()` 的关键规则：

- 读取 `VSCODE_PROXY_URI` / `vscode_proxy_uri`
- 用 `process.env.PORT || "3000"` 替换 `{{port}}`
- 调用 `collapseDuplicatedLeadingProxyPrefix()`

这决定了 `/_next/*` 前缀和 deep proxy 场景下静态资源是否能稳定加载。

### 3.3 登录 redirect safety：清洗 `from` 参数中的污染前缀

`src/app/[locale]/login/redirect-safety.ts` 中：

- `sanitizeRedirectPath()`
- `collapseDuplicatedLeadingProxyPrefix()`

除了原有 open redirect 防护，还会清洗类似：

- `/proxy/3000/ws-a/proxy/3000/zh-CN/dashboard`

确保登录成功后的 `from` 参数不会再次把污染路径带回应用。

### 3.4 Key Soft Block：Redis 写入、Redis 回读与双入口拦截

#### Redis 配置存储

文件：

- `src/lib/key-soft-block-store.ts`

Redis 键：

- `cch:key-soft-block:${keyId}`

保存：

- `enabled`
- `message`

若 Redis 不可用：

- 读取时回退为未启用
- 写入时返回错误，避免 UI 误以为保存成功

#### Dashboard 新增 / 编辑 / 再次打开回填

关键文件：

- `src/actions/keys.ts`
- `src/actions/users.ts`
- `src/app/[locale]/dashboard/_components/user/forms/add-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx`
- `src/app/[locale]/dashboard/_components/user/forms/key-edit-section.tsx`
- `src/app/[locale]/dashboard/_components/user/create-user-dialog.tsx`

当前规则：

- 新增 Key 时会把 `softBlockEnabled` / `softBlockMessage` 一并写入 Redis
- 编辑 Key 时显式提交 soft block 字段会覆盖 Redis 当前配置
- 用户列表与 Key 列表返回结果会补齐 Redis 中的 soft block 状态
- 编辑弹窗再次打开时，开关与提示词使用最新 Redis 回读值回填

#### Proxy 拦截

关键文件：

- `src/app/v1/_lib/proxy/key-soft-block.ts`
- `src/app/v1/_lib/proxy/auth-guard.ts`
- `src/app/v1/_lib/models/available-models.ts`

当前行为：

- `auth-guard` 在 API Key 校验成功后立即执行 `handleKeySoftBlock(session)`
- `/v1/models` 认证成功后也会读取同一份 Redis 配置
- Gemini `?key=` 查询参数认证在 `/v1/models` 也保持可用
- 命中时统一返回 `ProxyResponses.buildError(401, message, "user_disabled")`

### 3.5 登录 branding：最小公开接口 + base-path 感知请求 + 隐藏公共 footer

关键文件：

- `src/app/api/public/site-info/route.ts`
- `src/app/[locale]/login/page.tsx`
- `src/components/customs/footer-wrapper.tsx`
- `src/components/proxy-fetch-initializer.tsx`

当前规则：

- branding 请求走 `apiFetch("/public/site-info")`
- version 请求走 `apiFetch("/version")`
- 登录提交走 `apiFetch("/auth/login")`
- `/login` 页面通过 `FooterWrapper` 隐藏根 layout 公共 footer

### 3.6 `my-usage` / usage logs：`originalModel` 优先语义彻底收齐

关键文件：

- `src/actions/my-usage.ts`
- `src/actions/usage-logs.ts`
- `src/repository/_shared/usage-log-filters.ts`
- `src/repository/usage-logs.ts`

当前行为：

- `my-usage` 列表优先展示 `originalModel`
- summary / breakdown 按 `COALESCE(originalModel, model)` 聚合
- usage logs 查询、筛选、统计和 distinct model 列表统一按 billing model source

### 3.7 opencode Claude Messages 自动追加 `beta=true`

关键文件：

- `src/app/v1/_lib/proxy/forwarder.ts`

当前规则：

- 当客户端 `User-Agent` 命中 `opencode`
- 且目标 provider 为 `claude` / `claude-auth`
- 且请求路径为 `/v1/messages`
- 且上游 URL 尚未显式带 `beta` 参数

则 CCH 会在最终转发到上游前自动追加：

- `?beta=true`

边界约束：

- 仅作用于 opencode，不影响其他客户端
- 仅作用于 Claude Messages，不影响其他端点
- 若调用方已显式传入 `beta=...`，则保持原值，不做覆盖

### 3.8 VIP 提醒与迁移幂等

关键文件：

- `src/app/v1/_lib/proxy/forwarder.ts`
- `src/lib/redis/vip-group-usage-config.ts`
- `src/lib/notification/notifier.ts`
- `src/lib/notification/notification-queue.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`
- `drizzle/0088_outstanding_cammi.sql`

当前机制：

- provider 选中成功后，如果 `groupTag` 命中 `vip`，则异步触发提醒
- Redis 读取运行时配置，默认 `enabled=true`、`cooldownSeconds=300`
- 去重键为 `vip-group-usage-alert:${providerId}:${sessionId || "no-session"}`
- 迁移使用幂等方式增补 `vip_group_usage` 枚举值

---

## 4. 测试与验证

本轮重点关注的测试集：

- `tests/unit/proxy/proxy-login-basepath-recovery.test.ts`
- `tests/unit/lib/base-path-dynamic.test.ts`
- `tests/unit/workspace-aware-redirect.test.ts`
- `tests/unit/footer-wrapper.test.tsx`
- `tests/unit/repository/usage-logs-model-source.test.ts`
- `tests/unit/webhook/notifier-vip-group-usage.test.ts`
- `tests/unit/webhook/templates/placeholders.test.ts`
- `tests/unit/webhook/templates/templates.test.ts`
- `tests/unit/login/login-footer-system-name.test.tsx`
- `tests/unit/proxy/key-soft-block.test.ts`
- `tests/unit/models/available-models-gemini-key.test.ts`
- `tests/unit/user-dialogs.test.tsx`

建议至少做以下运行态验证：

- `.../proxy/3000/zh-CN/login` 下确认 branding / version 请求仍命中正确 base path
- workspace bare-locale 根路径在有 cookie / 无 cookie 两种情况下不自循环
- `my-usage` / dashboard logs 在模型重定向时都显示原始模型
- VIP provider 命中后在 cooldown 窗口内不会重复刷屏
- `bun run db:migrate` 在 enum 已存在环境下可重复执行
- 用户管理中的 Key 临时限制与自定义提示词可真正拦截请求并正确回填

---

## 5. 后续修改必须遵守的规则

### 5.1 修改 SII 路径逻辑时

- `src/proxy.ts` 与 `next.config.ts` 的默认端口和前缀算法必须同步维护
- 不要轻易把 in-process reprocess 改回外部 307/302
- referer 恢复必须坚持“只允许 richer base path 恢复 poorer path”
- workspace bare-locale 根路径必须当成真实 app 入口处理

### 5.2 修改登录 branding 时

- `api/public/site-info` 只承担最小公开 branding，不要膨胀成公开配置总接口
- 登录页 branding 获取失败必须 fail-open，不影响登录主流程
- 登录页 API 请求必须保持 base-path 感知，不能依赖挂载时序偶然成功
- 若调整 footer 策略，必须同时检查 `/login` 是否出现重复品牌信息

### 5.3 修改模型语义时

- 展示、筛选、聚合、模型下拉、统计摘要必须保持同一语义
- 只要 UI 选择“原始模型优先”，SQL 就必须统一用 `COALESCE(originalModel, model)`
- `message_request` 与 `usage_ledger` 两条路径必须同步修改

### 5.4 修改 VIP 告警与 Key Soft Block 时

- schema、迁移、repository、action、UI、i18n 必须全链路同步
- Notification 类型、Webhook 模板字段与测试消息必须保持一致
- 默认模板字段必须忠实反映 payload 语义
- Key Soft Block 仍然保持 Redis-only，不要偷偷引入 DB schema 绑定
- `/v1/models` 与主请求链路必须保持同口径拦截

---

## 6. 结论

当前 `0.6.8` 这组实现的本质成果可以概括为：

- SII 代理路径 canonicalization 继续收敛，referer 恢复边界更清晰
- 构建时与运行时默认代理端口统一为 `3000`
- 登录 branding 通过最小公开接口获取，并隐藏公共 footer
- 登录页首屏 API 请求改为 base-path 感知，减少 branding / version 的挂载竞态
- `my-usage` / usage logs 改为真正闭环的“原始模型优先”语义
- `vip_group_usage` 完成从 Redis 配置到 UI 到 webhook 的全链路接入，并修正默认模板字段语义
- enum 迁移按幂等方式处理，降低半漂移环境重复执行失败风险
- Key Soft Block 完成 Redis 写入、Redis 回读、代理拦截与编辑回填闭环

后续维护时，请把这三类一致性作为最高优先级约束：

- 路径 canonicalization 一致性
- `originalModel` 展示 / 筛选 / 聚合语义一致性
- notification 类型、迁移、模板字段与 Key Soft Block 运行时拦截的一致性
