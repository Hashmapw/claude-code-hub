# SII Support、Key Soft Block 与部署对齐实现说明（v0.6.4）

本文档用于记录 `v0.6.4` 分支最近三次关键提交合并后的核心能力与维护边界：

- `24a03fe4`：落地 SII 深层代理路径支持、登录 branding、`my-usage` 原始模型语义，以及 `vip_group_usage` 提醒链路
- `5805437d`：新增基于 Redis 的 key soft block 运行时拦截
- `3cd712ea`：对齐 `docker-compose.yaml` 的部署布局，统一端口、网络名、容器名与健康检查语义

重点仍然是“机制、边界、验证与后续维护规则”，不是逐文件罗列所有 diff。

目标读者：

- 后续版本维护者
- 需要在 `0.6.4` / 后续发布分支继续维护 SII 路径、登录 branding、使用量语义、运行时限制与部署脚本的开发者

提交参考：

- feature commit: `24a03fe4`
- feature commit: `5805437d`
- feature commit: `3cd712ea`
- release branch: `origin/0.6.4`

---

## 1. 背景与问题定义

### 1.1 SII Notebook / VSCode 深层代理前缀

在 SII Notebook 网关下，应用的真实访问路径通常不是根路径，而是类似：

`/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/3000`

这类场景里，历史问题主要集中在以下几类：

- canonical workspace path 被污染成带前置 `/proxy/<port>` 的路径
- `/_next/static/*` 资源前缀回退到错误端口，导致 404 / 500
- referer 恢复逻辑可能把 richer workspace path 错误降级成短路径
- 登录 `from` 参数残留污染前缀，登录成功后再次带回错误路径
- workspace bare-locale 根路径，例如 `.../proxy/3000/zh-CN`，可能被错误生成为“跳回自己”的 HTML redirect，导致浏览器自循环

因此 `v0.6.4` 不只是延续 `v0.6.3` 的 canonicalization 逻辑，还要求服务端、构建期和客户端入口都统一围绕 `3000` 端口与 workspace-aware base path 工作。

### 1.2 登录 branding 与公共 footer

登录页需要在未登录态展示站点标题，但不应该依赖后台权限接口或过重的系统设置接口。

同时登录页已经有自己的品牌区块，如果全站公共 footer 继续出现，会造成：

- branding 重复
- 标题 / 版本重复
- 登录页视觉噪音增加

在 SII / Notebook base-path 场景下还存在一个额外运行时边界：

- 如果 branding 请求是裸 `fetch("/api/...")`
- 而 base-path fetch patch 尚未挂载

那么首屏 branding / version 可能请求到错误根路径，表现为默认标题闪回或偶发获取失败。

### 1.3 `my-usage` / usage logs 的原始模型语义

模型发生重定向时，用户更关心“原始请求模型”，而不是最终转发模型。

因此展示、筛选、聚合都必须围绕：

`COALESCE(originalModel, model)`

如果只改其中一层，就会出现这些回归：

- 列表展示原始模型，但筛选仍按最终模型
- `my-usage` breakdown 看起来正确，但 usage logs distinct model 仍是 redirected model
- repository 主表路径与 fallback / 聚合路径口径不一致

### 1.4 VIP 高成本分组提醒

当请求命中的 provider `groupTag` 包含 `vip` 时，需要发出请求级提醒，用于：

- 高成本线路审计
- 快速发现误用 VIP provider
- 接入现有 notification target + binding + test message 体系做联调

要求：

- Redis 可配置开关，默认开启
- Redis 可配置去重窗口，默认 300 秒
- 同一 `providerId + sessionId` 在去重窗口内只提醒一次
- 模板变量必须忠实反映真实 payload，不能用错误字段误导接收方

### 1.5 Key Soft Block：临时限制而不是删 key / 改 DB

`v0.6.4` 新增的 key soft block 不是“删除 key”、“禁用用户”或“新增数据库字段”，而是：

- 由 dashboard 编辑 key 时写入 Redis 运行时配置
- 在 proxy 认证成功后追加一次 guard 拦截
- 直接返回 `401 user_disabled`
- 同时把 guard 命中信息写入当前 session special settings

这样做的目的：

- 不改动 key 原始数据库结构
- 保留 key 元信息、统计与 UI 可编辑能力
- 支持临时封禁和自定义返回提示词

### 1.6 Docker Compose 部署布局需要与运行时口径一致

`v0.6.4` 的 compose 对齐，解决的不是“加一个服务”这么简单，而是发布分支反复部署时容易出现的几类漂移：

- app 内部监听端口与外部映射端口不一致
- 容器名 / 网络名未参数化，多个环境互相冲突
- DSN / REDIS_URL 仍引用旧容器名或 `localhost`
- 健康检查路径与实际服务监听路径不一致
- 数据目录、代理环境变量和 localhost-only 暴露策略不统一

---

## 2. 总体设计

### 2.1 路径与静态资源：三层协同继续收敛

当前实现仍然是“三层协同”：

- 服务端 `src/proxy.ts` 负责 canonicalization、污染路径收敛、referer 恢复边界与 bare-locale 根路径判定
- 构建时 `next.config.ts` 负责 `assetPrefix`
- 客户端 base-path / redirect / fetch / navigation 体系负责浏览器侧补前缀与入口跳转

### 2.2 登录 branding：公开最小接口 + base-path 感知请求

登录页通过最小公开接口拿站点标题：

- `GET /api/public/site-info`

同时通过：

- `apiFetch(...)`
- `ProxyFetchInitializer`
- `FooterWrapper`

把 base-path 获取、首屏请求和 footer 隐藏三件事收拢到统一链路。

### 2.3 `my-usage` / usage logs：统一按原始模型优先

`my-usage` 展示、统计聚合、usage logs 筛选与 distinct model 列表统一按：

- `COALESCE(originalModel, model)`

保证列表、筛选、聚合三处语义一致。

### 2.4 VIP 告警：请求链路触发，Redis 配置与去重，通知队列派发

VIP 提醒链路仍然是：

- proxy request 选中 provider 后触发
- Redis 读取启停与 cooldown
- Redis `NX + EX` 做去重
- notification queue 按 binding 派发
- webhook template 统一渲染

### 2.5 Key Soft Block：Redis-only 运行时配置

key soft block 的关键设计是：

- 配置存 Redis，不进 DB schema
- dashboard action 读写 Redis 配置
- `auth-guard` / `/v1/models` 都做同口径拦截
- 统一返回 `ProxyResponses.buildError(401, ..., "user_disabled")`

### 2.6 Compose 部署：命名、端口、健康检查与数据目录统一

`docker-compose.yaml` 当前统一了：

- `APP_PORT` 既作为容器内部 `PORT`，也作为外部端口映射
- `DEPLOY_SUFFIX` 同时参与容器名和网络名
- app 内部通过 compose service name 访问 postgres / redis
- 健康检查走 `/api/actions/health`
- 持久化目录固定在 `./data/postgres` 与 `./data/redis`

---

## 3. 关键实现细节

### 3.1 `src/proxy.ts`：canonicalization、referer 恢复与 bare-locale 根路径修正

`v0.6.4` 继续坚持三条规则：

1. env base path 默认端口使用 `process.env.PORT || "3000"`
2. richer referer 才允许恢复 poorer path，不允许反向 downgrade
3. 尽量走进程内重处理，不走外部 307

这直接决定：

- SII canonical workspace path 是否能稳定收敛
- `/_next/static/*` 是否还会错误回到 `proxy/4000`
- bare-locale 根路径会进入真实 app 入口，还是生成“跳回自己”的 HTML redirect

### 3.2 `next.config.ts`：`assetPrefix` 与 `3000` 端口统一

`getAssetPrefix()` 的关键规则：

- 读取 `VSCODE_PROXY_URI` / `vscode_proxy_uri`
- 用 `process.env.PORT || "3000"` 替换 `{{port}}`
- 调用 `collapseDuplicatedLeadingProxyPrefix()`

它与 `src/proxy.ts` 必须同口径维护，否则会出现：

- 服务端路径看起来正确
- 但页面静态资源仍从错误端口加载

### 3.3 登录链路：redirect safety、public site-info 与 footer 隐藏

关键文件：

- `src/app/[locale]/login/redirect-safety.ts`
- `src/app/api/public/site-info/route.ts`
- `src/app/[locale]/login/page.tsx`
- `src/components/customs/footer-wrapper.tsx`
- `src/components/proxy-fetch-initializer.tsx`

当前规则是：

- `sanitizeRedirectPath()` 清理 `from` 参数中的污染代理前缀
- 登录页 branding / version / login 请求统一走 `apiFetch(...)`
- `/login` 页面隐藏根 layout 公共 footer

这样可以避免 base-path fetch patch 的挂载时序导致登录页偶发回退默认标题。

### 3.4 `my-usage` / usage logs：`originalModel` 优先语义彻底收齐

关键文件：

- `src/actions/my-usage.ts`
- `src/repository/_shared/usage-log-filters.ts`
- `src/repository/usage-logs.ts`

维护要点：

- 列表展示优先 `originalModel`
- summary / breakdown 聚合按 `COALESCE(originalModel, model)`
- model filter / suggestion / distinct model 列表也按同一语义

也就是说，后续如果改模型展示，不允许只改 UI，不改 repository 层筛选与聚合。

### 3.5 VIP 使用提醒：触发点、去重与模板字段

关键文件：

- `src/app/v1/_lib/proxy/forwarder.ts`
- `src/lib/notification/notifier.ts`
- `src/lib/redis/vip-group-usage-config.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`

当前机制：

- 请求成功选中 provider 后，如果 `groupTag` 命中 `vip`，则触发提醒
- Redis 键 `notification:vip-group-usage:config` 保存启停和 `cooldownSeconds`
- 去重键为 `vip-group-usage-alert:${providerId}:${sessionId || "no-session"}`
- 模板字段使用真实 `providerGroupTag`，不伪装成 `keyGroup`

这条“字段语义忠实”规则非常重要，因为通知模板一旦写错字段，测试消息可能通过，但真实线上含义会错。

### 3.6 Key Soft Block：Redis 配置、dashboard 编辑与 proxy 拦截

关键文件：

- `src/lib/key-soft-block-store.ts`
- `src/actions/keys.ts`
- `src/actions/users.ts`
- `src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx`
- `src/app/v1/_lib/proxy/key-soft-block.ts`
- `src/app/v1/_lib/proxy/auth-guard.ts`
- `src/app/v1/_lib/models/available-models.ts`

当前机制分三层：

#### 配置存储层

`src/lib/key-soft-block-store.ts` 使用 Redis 键：

- `cch:key-soft-block:${keyId}`

保存：

- `enabled`
- `message`

若 Redis 不可用：

- 读取时回退为未启用
- 写入时返回错误，避免 UI 误以为已生效

#### Dashboard 编辑层

`src/lib/validation/schemas.ts` 中：

- `softBlockEnabled` 是显式布尔开关
- `softBlockMessage` 最长 500 字符
- 若开启 soft block，则 `softBlockMessage` 必填

`src/actions/keys.ts` 中：

- `editKey` 更新完 key 常规字段后，再调用 `setKeySoftBlockConfig(...)`
- `getKeys` / `users` 相关 action 会把 Redis 里的 soft block 配置补到返回结构里

这意味着：

- soft block 不占用数据库字段
- 但列表页 / 编辑弹窗仍能读取和回填当前状态

#### Proxy 拦截层

`src/app/v1/_lib/proxy/auth-guard.ts` 在 API key 校验成功后，会立即执行：

- `handleKeySoftBlock(session)`

若命中：

- 生成或复用当前 `sessionId`
- 写入一条 `guard_intercept` special setting，`guard = "key_soft_block"`
- 返回 `ProxyResponses.buildError(401, message, "user_disabled")`

同时 `/v1/models` 也会读取同一份 Redis 配置并做一致性拦截，避免出现：

- 请求主链路被禁
- 但模型列表仍然看起来可用

### 3.7 Docker Compose：部署布局对齐点

关键文件：

- `docker-compose.yaml`

当前对齐点包括：

- postgres / redis / app 三个服务容器名都带 `-${DEPLOY_SUFFIX:-prod}`
- app 的 `PORT` 使用 `${APP_PORT:-3000}`
- 端口映射使用 `127.0.0.1:${APP_PORT:-3000}:${APP_PORT:-3000}`
- `DSN` / `REDIS_URL` 通过 compose service name 指向带 suffix 的容器名
- 网络名固定为 `claude-code-hub-net-${DEPLOY_SUFFIX:-prod}`
- app 健康检查使用 `curl -f http://localhost:${APP_PORT:-3000}/api/actions/health`

这些约束解决的是“多环境并行部署”和“重部署后仍沿用旧命名/旧端口”的典型漂移问题。

### 3.8 为什么 Key Soft Block 与 Compose 对齐都不应该改成数据库驱动

这两处看起来都像“也许可以加表/加列”的场景，但 `v0.6.4` 的设计有意保持轻量：

- Key Soft Block 选择 Redis-only，是为了运行时临时限制、快速回滚和避免 schema 膨胀
- Compose 对齐选择环境变量 + 命名规范，是为了部署时的幂等与环境复用，而不是把部署信息写死到应用逻辑里

因此后续若继续演进，应优先保持：

- 运行时配置走 Redis / env
- 业务实体走数据库

不要把两者混在一起。

---

## 4. 测试与验证

### 4.1 单元测试覆盖的关键文件

与 `v0.6.4` 文档主题直接相关的测试包括：

- `tests/unit/auth/login-redirect-safety.test.ts`
- `tests/unit/lib/base-path-dynamic.test.ts`
- `tests/unit/proxy/proxy-auth-cookie-passthrough.test.ts`
- `tests/unit/actions/my-usage-original-model-display.test.ts`
- `tests/unit/repository/usage-logs-sessionid-filter.test.ts`
- `tests/unit/webhook/notifier-vip-group-usage.test.ts`
- `tests/unit/webhook/templates/placeholders.test.ts`
- `tests/unit/proxy/key-soft-block.test.ts`
- `tests/unit/dashboard/edit-key-form-expiry-clear-ui.test.tsx`
- `tests/unit/actions/keys-edit-key-expires-at-clear.test.ts`

### 4.2 运行态验证建议

建议至少覆盖以下链路：

1. SII / Notebook 路径验证
   - 打开带 workspace 前缀的 `/proxy/3000/zh-CN/login`
   - 观察 `_next/static` 请求是否仍落到 `3000`
   - 验证 bare-locale 根路径不会自循环

2. 登录 branding 验证
   - 未登录页确认站点标题能通过 `/api/public/site-info` 正常显示
   - 确认登录页不再渲染公共 footer

3. `my-usage` / usage logs 语义验证
   - 构造一次模型重定向请求
   - 对比列表展示、筛选和 breakdown 是否都以原始模型为准

4. VIP 告警验证
   - 选中 `groupTag` 含 `vip` 的 provider
   - 在 cooldown 窗口内重复请求，确认不会重复刷屏
   - 检查测试消息和真实消息字段是否一致

5. Key Soft Block 验证
   - 在 dashboard 对某个 key 开启 soft block 并填写自定义文案
   - 用该 key 请求 `/v1/responses` 或 `/v1/models`
   - 预期返回 `401`，错误类型为 `user_disabled`
   - 错误提示词应等于 dashboard 中配置的文案

6. Compose 验证
   - 执行 `docker compose config`
   - 确认容器名、网络名、端口映射和健康检查路径与 `.env` 口径一致

---

## 5. 后续修改必须遵守的规则

### 5.1 修改 SII 路径逻辑时

- `src/proxy.ts`、`next.config.ts`、客户端 base-path 工具必须一起看
- 不能只修 redirect，不修 `assetPrefix`
- 不能把 richer referer 恢复规则改成“谁都能覆盖谁”

### 5.2 修改登录 branding 时

- 未登录页只能依赖公开最小接口
- 登录页请求必须保持 base-path 感知
- 不要把公共 footer 再带回 `/login`

### 5.3 修改 `my-usage` 模型语义时

- UI、action、repository、distinct model 列表必须同口径
- 统一围绕 `COALESCE(originalModel, model)`

### 5.4 修改 VIP 告警时

- 先确认字段语义，再改模板
- 去重键和 cooldown 规则不能随意改成更粗粒度，否则容易漏告警

### 5.5 修改 Key Soft Block 时

- 优先保持 Redis-only 运行时配置
- `/v1/models` 与主请求链路必须保持同口径拦截
- 命中时返回类型必须稳定为 `user_disabled`

### 5.6 修改部署脚本 / compose 时

- 端口、容器名、网络名、DSN、REDIS_URL 必须成组检查
- 若引入新环境变量，要同时确认 `.env`、compose、healthcheck 与文档说明

---

## 6. 常见排查清单

### 6.1 页面仍请求 `proxy/4000/_next/static/...`

优先检查：

- `next.config.ts` 的 `assetPrefix` 是否仍按 `PORT || "3000"` 展开
- `VSCODE_PROXY_URI` 是否带旧端口
- workspace 路径是否被重复拼接了 `/proxy/<port>`

### 6.2 登录页标题不显示或又出现重复 footer

优先检查：

- `/api/public/site-info` 是否可访问
- 登录页是否仍使用 `apiFetch(...)`
- `FooterWrapper` 是否仍对 `/login` 返回 `null`

### 6.3 `my-usage` 模型看起来不像用户实际请求的模型

优先检查：

- repository filter 是否仍按 `COALESCE(originalModel, model)`
- 前端展示是否优先读取 `originalModel`
- breakdown 与 distinct model 是否走了不同口径

### 6.4 VIP 提醒不触发

优先检查：

- provider `groupTag` 是否真的命中 `vip`
- Redis 中 `notification:vip-group-usage:config` 是否被关闭
- binding 是否存在
- 去重键是否因同一 `providerId + sessionId` 命中 cooldown

### 6.5 某把 key 被限制后接口返回不一致

优先检查：

- dashboard 是否真的写入了 `cch:key-soft-block:${keyId}`
- `/v1/models` 与主请求端点是否都走到同一份 soft block 配置
- 返回是否为 `401 user_disabled`

### 6.6 `docker compose up` 后服务名、网络名或端口不对

优先检查：

- `.env` 中 `APP_PORT`、`DEPLOY_SUFFIX`
- `docker compose config` 展开后的容器名、网络名与端口映射
- app 的 `DSN` / `REDIS_URL` 是否仍引用旧服务名或 `localhost`

---

## 7. 结论

`v0.6.4` 相比 `v0.6.3`，不是单点功能叠加，而是把以下几条能力串成了更稳定的发布分支语义：

- SII 深层代理路径与静态资源前缀继续收敛到 `3000`
- 登录 branding 与 base-path 请求链路更加稳态
- `my-usage` / usage logs 的原始模型语义收齐
- VIP 高成本提醒具备 Redis 配置、去重与模板输出闭环
- key soft block 以 Redis-only 方式实现可回填、可拦截、可审计的运行时限制
- `docker-compose.yaml` 的端口、命名、网络与健康检查完成对齐

后续若继续维护该版本线，最重要的不是“照着文件名改”，而是保持这些能力在路径、运行时配置、通知与部署四个维度上的同口径。
