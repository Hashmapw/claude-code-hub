# SII Support、登录 Branding 与 Key Soft Block 实现说明（v0.6.7）

本文档记录当前 `main` 分支落地的、对齐当前 `0.6.7` 交付分支中 SII 路径、登录 branding、VIP 提醒与 Key Soft Block 的完整能力。

这不是“逐文件照搬 diff”的说明，而是当前代码基线上真实保留的机制边界，以及这轮对齐后需要继续遵守的维护规则。

当前文档聚焦 5 条主线：

- SII Notebook / VSCode 深层代理前缀支持继续收敛
- 默认代理端口统一为 `3000`
- 登录 branding 与公共 footer 调整
- `my-usage` / usage logs 的 `originalModel` 优先语义
- VIP 高成本分组提醒（`vip_group_usage`）全链路接入
- Key Soft Block：Redis 写入、Redis 回读、代理拦截与编辑回填闭环

另外，本文档也记录本轮在 `main` 上一并收口的后续问题：

- `usage-logs` repository 层剩余 model filter / distinct-model 语义补齐
- 登录页 branding / version 首屏请求改为 base-path 感知，避免挂载时序竞态
- `vip_group_usage` 默认模板字段语义纠正，不再把 provider group 错标成 key group
- workspace bare-locale 根路径（`.../proxy/3000/zh-CN`）恢复成正确的登录 / 首页跳转语义，不再生成自循环跳转页
- `vip_group_usage` 枚举迁移按幂等方式生成，避免环境漂移时再次触发 `enum label already exists`
- Key 编辑入口再次打开时，soft block 开关与提示词可从 Redis 正确回填

目标读者：

- 后续版本维护者
- 需要在 `main` 上继续维护代理路径 / branding / usage / notification 语义的开发者

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
- workspace bare-locale 根路径，例如 `.../proxy/3000/zh-CN`，可能被错误生成为“跳回自己”的 HTML redirect，从而触发浏览器自循环

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
- message_request 路径和 usage_ledger 路径语义不一致

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

当前 `0.6.7` 保持的临时限制方案：

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

本轮在 `main` 上除了延续原 `0.6.6` 思路，还补了一个重要收口：

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

但当前实现特别强调一件事：

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

这能避免 Notebook 网关把 `Location` 再次改写成污染路径。

#### workspace bare-locale 根路径现在会被当成真实 app 入口

此前 `extractWorkspaceAppPath()` 对：

- `.../ws-.../proxy/3000/zh-CN`

这类 bare-locale 根路径会落入相对 HTML redirect，目标仍指回当前地址，从而自循环。

现在这类路径恢复为：

- 有 auth cookie：rewrite 到 `/{locale}`，再由应用首页继续到 `/dashboard`
- 无 auth cookie：进入未登录跳转链路，跳到 `/{locale}/login`

### 3.2 `next.config.ts`：`assetPrefix` 与 `3000` 端口统一

`getAssetPrefix()` 的关键规则：

- 读取 `VSCODE_PROXY_URI` / `vscode_proxy_uri`
- 用 `process.env.PORT || "3000"` 替换 `{{port}}`
- 调用 `collapseDuplicatedLeadingProxyPrefix()`

这决定了：

- 页面生成的 `/_next/*` 前缀
- 线上是否还会退回到 `proxy/4000/_next/static/...`

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

当前使用 Redis 键：

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
- 编辑 Key 时如果显式提交 soft block 字段，会覆盖 Redis 当前配置
- 用户列表与 Key 列表返回结果会补齐 Redis 中的 soft block 状态
- 编辑弹窗再次打开时，开关与提示词使用最新 Redis 回读值回填

这保证：

- “临时限制该 Key 使用”关闭后，该 Key 可继续正常发起请求
- 自定义限制提示词不会只存在于某次前端草稿，而会从 Redis 持久回填

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

也就是说，不会再出现：

- 主请求链路被限制
- 但 `/v1/models` 看起来仍然可用

### 3.4 登录 branding：最小公开接口 + base-path 感知请求 + 隐藏公共 footer

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

这样即使 `ProxyFetchInitializer` 的 patch 还在挂载中，登录页也能直接按当前 base path 发请求。

### 3.5 `my-usage` / usage logs：`originalModel` 优先语义彻底收齐

关键文件：

- `src/actions/my-usage.ts`
- `src/actions/usage-logs.ts`
- `src/repository/_shared/usage-log-filters.ts`
- `src/repository/usage-logs.ts`

当前行为：

- `my-usage` 列表优先展示 `originalModel`
- summary / breakdown 按 `COALESCE(originalModel, model)` 聚合
- usage logs 查询、筛选、统计和 distinct model 列表统一按 `billingModelSource`
- `getDistinctModelsForKey()` 与 `getUsedModels()` 都按当前 billing model 语义返回模型列表

这意味着后续若调整模型语义，不能只改 UI，不改 repository 和 action 层。

### 3.6 VIP 使用提醒全链路

关键文件：

- `src/app/v1/_lib/proxy/forwarder.ts`
- `src/lib/redis/vip-group-usage-config.ts`
- `src/lib/notification/notifier.ts`
- `src/lib/notification/notification-queue.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`
- `src/lib/webhook/templates/defaults.ts`
- `src/lib/webhook/templates/placeholders.ts`
- `src/lib/webhook/templates/test-messages.ts`

当前机制：

- provider 选中成功后，如果 `groupTag` 命中 `vip`，则异步触发提醒
- Redis 读取运行时配置，默认 `enabled=true`、`cooldownSeconds=300`
- 去重键为 `vip-group-usage-alert:${providerId}:${sessionId || "no-session"}`
- notification queue 以 `vip-group-usage` job type 入队
- webhook 模板字段使用真实 `providerGroupTag`

### 3.7 迁移与幂等要求

关键文件：

- `src/drizzle/schema.ts`
- `drizzle/0088_*.sql`

当前 `main` 这轮新增迁移只负责：

- 为 `notification_type` enum 增补 `vip_group_usage`

同时必须保持幂等：

- `ALTER TYPE ... ADD VALUE` 需要包进 `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL`

这样可以避免环境漂移时再次出现：

- `enum label "vip_group_usage" already exists`

---

## 4. 测试与验证

本轮重点关注的测试集：

路径与端口相关：

- `tests/unit/proxy/proxy-login-basepath-recovery.test.ts`
- `tests/unit/lib/base-path-dynamic.test.ts`
- `tests/unit/workspace-aware-redirect.test.ts`
- `tests/unit/footer-wrapper.test.tsx`

`my-usage` / usage logs `originalModel` 语义：

- `tests/unit/repository/usage-logs-model-source.test.ts`

VIP 告警与模板：

- `tests/unit/webhook/notifier-vip-group-usage.test.ts`
- `tests/unit/webhook/templates/placeholders.test.ts`
- `tests/unit/webhook/templates/templates.test.ts`

登录 branding：

- `tests/unit/login/login-footer-system-name.test.tsx`

建议至少做以下运行态验证：

1. `.../proxy/3000/zh-CN/login` 下确认 branding / version 请求仍命中正确 base path
2. workspace bare-locale 根路径在有 cookie / 无 cookie 两种情况下不自循环
3. `my-usage` / dashboard logs 在模型重定向时都显示原始模型
4. VIP provider 命中后在 cooldown 窗口内不会重复刷屏
5. `bun run db:migrate` 在 enum 已存在环境下可重复执行

---

## 5. 后续修改必须遵守的规则

### 5.1 修改 SII 路径逻辑时

1. `src/proxy.ts` 与 `next.config.ts` 的默认端口和前缀算法必须同步维护。
2. 不要轻易把 in-process reprocess 改回外部 307/302。
3. referer 恢复必须坚持“只允许 richer base path 恢复 poorer path”。
4. workspace bare-locale 根路径必须当成真实 app 入口处理，不能再次落回“跳回自己”的 HTML redirect。

### 5.2 修改登录 branding 时

1. `api/public/site-info` 只承担最小公开 branding，不要膨胀成公开配置总接口。
2. 登录页 branding 获取失败必须 fail-open，不影响登录主流程。
3. 登录页 API 请求必须保持 base-path 感知，不能依赖挂载时序偶然成功。
4. 若调整 footer 策略，必须同时检查 `/login` 是否出现重复品牌信息。

### 5.3 修改 `my-usage` 模型语义时

1. 展示、筛选、聚合、模型下拉、统计摘要必须保持同一语义。
2. 只要 UI 选择“原始模型优先”，SQL 就必须统一用 `COALESCE(originalModel, model)`。
3. message_request 与 usage_ledger 两条路径必须同步修改，不能只改一边。

### 5.4 修改 VIP 告警时

1. schema、迁移、repository、action、UI、i18n 必须全链路同步。
2. `NotificationJobType` 与 `WebhookNotificationType` 的映射必须同步修改。
3. 新增模板字段时，必须同步更新默认模板、占位符、变量构造与测试消息。
4. 默认模板字段必须忠实反映 payload 语义；不要把 provider 字段包装成不存在的 key 字段。
5. enum 迁移必须保持幂等，避免重复执行失败。

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
3. action 层是否把当前 `billingModelSource` 传给 repository

### 6.4 VIP 提醒不触发

检查：

1. 命中的 provider `groupTag` 是否包含 `vip`
2. Redis 中 VIP 提醒开关是否为开启状态；未配置时默认开启
3. 是否存在启用状态的 `vip_group_usage` binding
4. Redis 去重 key 是否在当前 `cooldownSeconds` 窗口内命中
5. 数据库是否已应用包含 `vip_group_usage` enum 的迁移

### 6.5 `.../proxy/3000/zh-CN` 反复请求自己

优先检查：

1. 线上实例是否已部署到包含 bare-locale 修复的新代码
2. 响应体是否仍然包含目标指回当前 bare-locale 的 HTML redirect
3. `src/proxy.ts` 中 workspace bare-locale 路径是否仍被误判

---

## 7. 结论

当前 `main` 上这组实现的本质成果可以概括为：

- SII 代理路径 canonicalization 继续收敛，referer 恢复边界更清晰
- 构建时与运行时默认代理端口统一为 `3000`
- 登录 branding 通过最小公开接口获取，并隐藏公共 footer
- 登录页首屏 API 请求改为 base-path 感知，减少 branding / version 的挂载竞态
- `my-usage` / usage logs 改为真正闭环的“原始模型优先”语义
- `vip_group_usage` 完成从 Redis 配置到 UI 到 webhook 的全链路接入，并修正默认模板字段语义
- enum 迁移按幂等方式处理，降低半漂移环境重复执行失败风险

后续维护时，请把这三类一致性作为最高优先级约束：

- 路径 canonicalization 一致性
- `originalModel` 展示 / 筛选 / 聚合语义一致性
- notification 类型、迁移和模板字段的全链路一致性
