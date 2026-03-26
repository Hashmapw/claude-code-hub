# SII Support、Key Soft Block、运行态回归修复与部署对齐实现说明（v0.6.6）

本文档用于记录当前 `0.6.6` 分支围绕 `0.6.5` 基线提交
`88ed407a4201beaab41230d5728c02d0b3123ba6`
完成的能力移植、适配收敛与额外运行态修复。

与 `v0.6.5` 文档相比，这一版的重点不只是“把能力带过来”，而是：

- 在当前本地 `main` / Next.js 16 / Zod 4 代码线上**理解原机制后等价实现**
- 保留当前主线已有能力，不把 `0.6.5` 的旧形态生硬覆盖到新主线
- 把在真实 SII Notebook 路径与 dashboard users 页面上暴露出来的运行态问题一起收口

目标读者：

- 后续 `0.6.6` / `main` 维护者
- 需要继续维护 SII 深层代理、登录 branding、usage model 语义、VIP 提醒、key soft block 与部署脚本的开发者
- 需要排查 Zod 4 schema 组合限制、迁移漂移和 notebook 深层路径回归的开发者

提交参考：

- baseline release commit: `88ed407a4201beaab41230d5728c02d0b3123ba6`
- inherited feature commit: `24a03fe4`
- inherited feature commit: `5805437d`
- inherited feature commit: `3cd712ea`
- target release branch: `0.6.6`

---

## 1. 背景与问题定义

### 1.1 `0.6.6` 的目标不是盲目 transplant，而是语义回移植

`88ed407a` 已经在 `0.6.5` 分支上把下面几块能力串了起来：

- SII Notebook / VSCode 深层代理路径收敛
- 登录 branding 与 base-path aware 请求
- `my-usage` / usage logs 原始模型优先语义
- VIP 高成本 provider usage 提醒
- Redis-only key soft block
- compose 部署布局对齐

但当前本地主线并不是 `0.6.5` 的静态快照，还存在这些现实约束：

- 主线已经有自己的 usage model source 语义扩展
- 页面与 action 结构相对 `0.6.5` 已继续演进
- 运行栈是 Next.js 16 + Zod 4，schema 组合行为比旧版本更严格
- 真实 Notebook 网关会把 `Location`、`/proxy/<port>` 与 workspace 深层路径拼出新的污染变体

因此 `0.6.6` 的工作边界是：

- 迁移机制，但不盲目回滚主线差异
- 保证当前主线已有功能不被破坏
- 对暴露出来的新运行态问题做顺手收口

### 1.2 SII Notebook 深层路径仍然是最高风险回归点

真实访问路径通常类似：

`/ws-<workspace>/project-<id>/user-<id>/vscode/<id>/<session>/proxy/3000/zh-CN/...`

这一类场景里，`0.6.6` 继续重点兜底这些问题：

- canonical workspace path 被错误污染成前置 `/proxy/3000/.../ws-...`
- `/_next/static/*` 请求丢失 workspace base path
- referer 恢复把 richer workspace path 降级成短 `/proxy/3000`
- 未登录跳转回 `/login` 时，先退回了短 base path，再被外层网关拼出双层 `/proxy/3000`
- bare-locale 根路径自循环

其中 `0.6.6` 新增收口的一类典型回归是：

- 访问 `/ws-.../proxy/3000/dashboard`
- 中间件提取出 `/dashboard`
- 未登录跳转时错误生成 `/proxy/3000/zh-CN/login?from=/dashboard`
- 最终线上被网关变成 `/proxy/3000/ws-.../proxy/3000/zh-CN/login?...`

### 1.3 `my-usage` 语义需要兼容主线现状，而不是回退主线能力

`0.6.5` 的核心要求是围绕：

`COALESCE(originalModel, model)`

统一展示、筛选、distinct model 与聚合。

但当前主线已有 `billingModelSource` 等可配置语义，因此 `0.6.6` 的适配策略不是“强行改回旧逻辑”，而是：

- 保留主线现有可配置能力
- 把 repository filter、distinct model、summary / breakdown 与展示口径收齐
- 避免只改 UI、不改 repository 的半迁移状态

### 1.4 Key Soft Block 依旧坚持 Redis-only

`0.6.6` 保留 `0.6.5` 的核心约束：

- dashboard 编辑 key 时写 Redis 运行时配置
- proxy 校验通过后统一执行 guard 拦截
- 返回 `401 user_disabled`
- `/v1/models` 与主请求链路保持一致性
- 不新增 DB 字段，不把临时限制做成 schema 膨胀

### 1.5 VIP usage alerts 继续保留 Redis 配置 + 去重闭环

对 `groupTag` 命中 `vip` 的 provider，请求链路继续保持：

- Redis 配置开关
- cooldown 去重
- notification binding 派发
- webhook template 渲染

维护重点仍然是“字段语义忠实”，不能把 provider 语义误写成 key 语义。

### 1.6 `0.6.6` 额外收口：迁移幂等与 Zod 4 schema 组合限制

本轮实际运行中又暴露出两类不属于 `0.6.5` 原文档、但对当前主线必须处理的问题：

1. **迁移幂等问题**
   - `drizzle/0086_colossal_sabretooth.sql` 初始仅执行
     `ALTER TYPE "public"."notification_type" ADD VALUE 'vip_group_usage';`
   - 多环境复跑时会报：`enum label "vip_group_usage" already exists`
   - 导致 `db:migrate` 与应用启动自动迁移失败

2. **Zod 4 schema 组合问题**
   - 对带 refinement / superRefine 的 schema 使用 `.extend()` 或 `.omit()`
   - 会在 `dashboard/users` 页面模块加载时直接抛错
   - 表现为 `/zh-CN/dashboard/users` 渲染 `Something went wrong!`

这两类问题都不是“可以稍后处理”的噪音，而是 `0.6.6` 要求一并解决的运行态阻塞项。

---

## 2. 总体设计

### 2.1 SII 路径仍然是服务端 + 构建时 + 客户端三层协同

当前仍然维持“三层协同”设计：

- `src/proxy.ts`：canonicalization、referer 恢复、workspace base path 保留、登录跳转收敛
- `next.config.ts`：`assetPrefix` 与 `PORT || 3000` 统一
- 客户端 base-path / fetch / navigation / redirect 体系：浏览器侧补前缀与入口跳转

### 2.2 登录 branding 与跳转恢复都必须 workspace-aware

登录页除了站点标题 / 版本请求要 base-path aware 外，未登录跳转本身也必须遵守同一规则：

- richer workspace base path 不能被短 `/proxy/3000` 覆盖
- 生成相对跳转 HTML 时，要以当前 canonical base path 做解析
- workspace 路径丢失后，不能再让外层 notebook 网关拼出新的污染路径

### 2.3 usage model 语义采用“保留主线能力 + 收齐口径”策略

这一版没有把当前主线强行回退成 `0.6.5` 的静态形态，而是：

- 保留现有 `billingModelSource` 能力
- 修正 repository filter / distinct model / action 展示的一致性
- 让当前主线行为继续可维护

### 2.4 schema 组合遵守 Zod 4 约束

后续在 dashboard 表单层修改带 refinement 的 schema 时，应优先遵守：

- 不对 refined schema 直接 `.extend()` 覆盖字段
- 不对 refined schema 直接 `.omit()` 再组合
- 若确需替换单个字段，优先以 `shape` 重建新的 `z.object({...})`
- 再把必需的 `.superRefine(...)` 规则显式补回去

### 2.5 迁移脚本继续保持发布后可幂等复跑

对可能落在多环境、且数据库状态已部分前置漂移的迁移，继续遵守：

- enum add 用 `DO $$ ... IF NOT EXISTS ... THEN ALTER TYPE ... END IF; $$`
- 列新增优先 `ADD COLUMN IF NOT EXISTS`
- 验收以 `bun run db:migrate` 的明确成功标记为准

---

## 3. 关键实现细节

### 3.1 `src/proxy.ts`：登录跳转需要继承 richer workspace base path

本轮在 `src/proxy.ts` 增加/强化了两个关键点：

1. `resolveTargetPathAgainstCurrentBase(...)`
   - 用当前请求的 canonical base path 解析短跳转目标
   - 避免 `/zh-CN/login` 在 notebook 场景下退回短 `/proxy/3000`

2. workspace app path 未登录跳转特殊处理
   - 当路径已经带 workspace base、但中间提取出了 bare app path 且用户未登录时
   - 不再先退回裸 `/dashboard` 再走通用登录跳转
   - 而是直接按 workspace base 生成：
     `/<workspace-base>/<locale>/login?from=...`

这一步解决的正是：

- 线上出现 `/proxy/3000/ws-.../proxy/3000/zh-CN/login?...` 的双层污染问题

### 3.2 `next.config.ts` 与 `assetPrefix` 仍然统一围绕 `3000`

`getAssetPrefix()` 继续：

- 读取 `VSCODE_PROXY_URI` / `vscode_proxy_uri`
- 用 `process.env.PORT || "3000"` 替换 `{{port}}`
- 调用 `collapseDuplicatedLeadingProxyPrefix()`

其维护原则没有变化：

- 不能只修 `src/proxy.ts` 而不看 `assetPrefix`
- 否则页面入口路径虽然看似正确，静态资源仍可能回退到错误端口

### 3.3 登录 branding 与 footer 隐藏链路保持稳定

继续沿用：

- `src/app/api/public/site-info/route.ts`
- `src/components/proxy-fetch-initializer.tsx`
- `src/components/customs/footer-wrapper.tsx`
- `src/app/[locale]/login/redirect-safety.ts`

目标仍然是：

- 未登录页站点标题通过公开最小接口获取
- branding 请求不受 base-path patch 挂载时序影响
- `/login` 不再重复渲染公共 footer

### 3.4 `my-usage` / usage logs：在主线能力上收齐模型口径

关键文件仍然包括：

- `src/actions/my-usage.ts`
- `src/repository/_shared/usage-log-filters.ts`
- `src/repository/usage-logs.ts`

但本版与 `0.6.5` 的差别在于：

- 没有强制把所有语义钉死成旧实现
- 而是围绕主线已有 `billingModelSource` 能力做一致化
- 确保 filter / distinct / summary / 展示不再彼此打架

### 3.5 VIP usage alerts：保留 `vip_group_usage` 通知链路

继续保持这些关键组件：

- `src/app/v1/_lib/proxy/forwarder.ts`
- `src/lib/notification/notifier.ts`
- `src/lib/redis/vip-group-usage-config.ts`
- `src/lib/webhook/templates/vip-group-usage.ts`

运行规则不变：

- 命中 `groupTag` 包含 `vip` 时触发
- Redis 保存启停与 cooldownSeconds
- 去重键围绕 `providerId + sessionId`
- 模板字段继续忠实反映 provider 语义

### 3.6 Key Soft Block：保持 Redis-only、主链路与 `/v1/models` 同口径

关键文件包括：

- `src/lib/key-soft-block-store.ts`
- `src/app/v1/_lib/proxy/key-soft-block.ts`
- `src/app/v1/_lib/proxy/auth-guard.ts`
- `src/app/v1/_lib/models/available-models.ts`
- `src/actions/keys.ts`
- `src/actions/users.ts`
- `src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx`

维护规则不变：

- 运行时配置在 Redis，不入 DB schema
- dashboard 可回填 / 编辑
- 命中时统一返回 `401 user_disabled`
- `/v1/models` 不能出现“主链路禁用但模型列表还可见”的口径分裂

### 3.7 `drizzle/0086_colossal_sabretooth.sql`：把 enum migration 改为幂等

`vip_group_usage` 相关 enum migration 在当前线必须保持可复跑。

本版已将原始直接执行的：

- `ALTER TYPE "public"."notification_type" ADD VALUE 'vip_group_usage';`

改为：

- `DO $$ ... IF NOT EXISTS (...) THEN ALTER TYPE ... END IF; END $$;`

这样做的直接收益是：

- 已有该 enum label 的环境不再启动即炸
- `bun run db:migrate` 可在漂移环境下成功执行
- 应用自动迁移不会因为重复 label 阻塞启动

### 3.8 dashboard users 页面：按 Zod 4 规则重建表单 schema

本轮运行态排障中，`dashboard/users` 暴露出两次典型错误：

- `Cannot overwrite keys on object schemas containing refinements. Use .safeExtend() instead.`
- `.omit() cannot be used on object schemas containing refinements`

这说明不能再沿用旧版“refined schema 上直接 extend / omit”的写法。

当前收敛方式是：

- `EditUserSchema`：直接用 `UpdateUserSchema.safeExtend(...)`
- `CreateKeySchema`：基于 `KeyFormSchema.shape` 重新 `z.object({...})`，再显式补 `superRefine`
- `UserFormSchema`：基于 `CreateUserSchema.shape` 重建前端字符串日期版本

维护边界：

- 只要上游 schema 带 refinement / preprocess / transform，就不要默认继续 `.extend()` / `.omit()`
- 若需要替换字段，优先重建 object schema，再补行为约束

### 3.9 `x-cch-proxy-rev`：当前线不再保留该响应头

`x-cch-proxy-rev` 曾用于现场确认部署版本，但当前线维护策略是：

- 不再继续保留该响应头
- 验收应回到真实行为本身，而不是依赖临时 revision marker

因此后续若线上仍看到该 header，应优先怀疑：

- 旧产物仍在运行
- 真实部署未切到本地最新代码

而不是默认认为当前代码又重新注入了这个头。

### 3.10 `docker-compose.yaml`：保持 `0.6.5` 的部署布局对齐

compose 继续沿用 `0.6.5` 的部署语义：

- `APP_PORT` 同时作为内部监听与外部映射端口
- `DEPLOY_SUFFIX` 同时参与容器名与网络名
- app 通过 compose service name 访问 postgres / redis
- 健康检查走 `/api/actions/health`
- 数据目录固定在 `./data/postgres` 与 `./data/redis`

---

## 4. 测试与验证

### 4.1 已完成的重点验证

本轮已完成的关键验证包括：

1. **迁移验证**
   - `bun run db:migrate`
   - 预期不再报 `enum label "vip_group_usage" already exists`
   - 当前已验证迁移成功输出 `[✓] migrations applied successfully!`

2. **类型与构建验证**
   - `bun run typecheck`
   - `bun run build`
   - 当前已验证通过，且 `ƒ /[locale]/dashboard/users` 可参与生产构建

3. **代理与登录链路回归测试**
   - `tests/unit/auth/login-redirect-safety.test.ts`
   - `tests/unit/lib/base-path-dynamic.test.ts`
   - `tests/unit/proxy/proxy-login-basepath-recovery.test.ts`

4. **SII / key soft block / VIP / usage 相关定向测试**
   - `tests/unit/footer-wrapper.test.tsx`
   - `tests/unit/proxy/key-soft-block.test.ts`
   - `tests/unit/repository/usage-logs-model-source.test.ts`
   - `tests/unit/webhook/notifier-vip-group-usage.test.ts`
   - `tests/unit/workspace-aware-redirect.test.ts`

### 4.2 运行态验收建议

建议至少覆盖下面几条真实链路：

1. **Notebook 登录跳转验收**
   - 用真实 `ws-.../proxy/3000/...` URL 访问未登录页
   - 预期不再出现前置 `/proxy/3000/ws-.../proxy/3000/...` 污染路径

2. **dashboard users 页面验收**
   - 打开 `/zh-CN/dashboard/users`
   - 预期不再出现 `Something went wrong!`
   - 日志中不再出现 `.extend()` / `.omit()` against refined schema 的 Zod 4 错误

3. **VIP usage migration 验收**
   - 重启后观察自动迁移日志
   - 预期不再出现 `vip_group_usage already exists`

4. **header 验收**
   - 对真实入口执行 `curl -I`
   - 预期当前运行态不再返回 `x-cch-proxy-rev`

---

## 5. 后续修改必须遵守的规则

### 5.1 修改 SII 路径逻辑时

- `src/proxy.ts`、`next.config.ts`、客户端 base-path 工具必须一起看
- 不能只修 redirect，不修 `assetPrefix`
- 不能把 richer referer 恢复逻辑改成“谁都能覆盖谁”
- 未登录登录跳转必须保留当前 canonical workspace base path

### 5.2 修改 usage model 语义时

- 保留当前主线的可配置能力边界
- UI、action、repository、distinct model、summary 必须同口径
- 不允许为了“看起来像 `0.6.5`”而回退主线已有能力

### 5.3 修改 key soft block 时

- 继续保持 Redis-only
- `/v1/models` 与主链路必须一致性拦截
- 命中返回类型必须稳定为 `user_disabled`

### 5.4 修改 VIP usage alerts 时

- 优先确认字段语义，再改模板
- cooldown 与去重键不要随意改粗粒度
- enum / migration 相关变更必须考虑幂等复跑

### 5.5 修改 dashboard users 相关 schema 时

- 先判断上游 schema 是否带 refinement / transform / preprocess
- 对 refined schema，不要默认继续 `.extend()` 或 `.omit()`
- 如果要替换字段，优先 `z.object({ ...schema.shape, field: ... })`
- 若上游有 `.superRefine()` 规则，必须显式补回

### 5.6 修改部署脚本 / compose 时

- 端口、容器名、网络名、DSN、REDIS_URL、healthcheck 要成组核对
- 若引入新环境变量，要同步检查 `.env`、compose 与文档说明

---

## 6. 常见排查清单

### 6.1 登录地址前面又多了一个 `/proxy/3000`

优先检查：

- `src/proxy.ts` 是否仍保留 workspace 未登录跳转的专门处理
- relative redirect target 是否仍按当前 canonical base path 解析
- live notebook URL 是否仍被外层网关拼出了双层 `/proxy/3000`

### 6.2 `dashboard/users` 再次白屏

优先检查：

- 是否又在 refined schema 上使用了 `.extend()` / `.omit()`
- 相关前端表单 schema 是否用 `shape` 重建后补回约束
- 产物是否真的是最新 build

### 6.3 应用启动时再次因为 `vip_group_usage` 迁移失败

优先检查：

- `drizzle/0086_colossal_sabretooth.sql` 是否仍为幂等写法
- 运行的是否是最新构建产物
- 是否有其他环境残留了旧 migration 文件

### 6.4 线上还看得到 `x-cch-proxy-rev`

优先检查：

- 当前部署是否真是最新构建
- 是否有旧容器 / 旧 standalone 产物未替换
- 是否存在其他代理层额外加头，而不是应用代码本身返回

---

## 7. 结论

`0.6.6` 的意义不只是把 `0.6.5` 的特性搬过来，而是把这条能力线在当前主线环境下重新收口为一套可维护语义：

- SII 深层代理路径、静态资源与登录跳转继续围绕 `3000` + workspace-aware base path 收敛
- 登录 branding 与 footer 隐藏链路保持稳态
- `my-usage` / usage logs 的模型语义在保留主线能力的前提下继续收齐
- VIP usage alerts 与 key soft block 仍保持 Redis-only 运行时配置闭环
- `vip_group_usage` 迁移具备幂等复跑能力
- dashboard users 页面适配了 Zod 4 对 refined schema 组合的限制
- compose 部署布局继续与运行时口径一致

后续维护最重要的原则仍然不是“逐文件照抄”，而是保持路径、运行时配置、schema 组合、通知与部署这五个维度上的同口径。
