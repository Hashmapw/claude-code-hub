# GitHub Actions CI/CD 配置说明

## 📋 工作流概览

本项目包含两个独立的 GitHub Actions 工作流：

### 1. PR 构建检查 (`pr-check.yml`)

- **触发条件**：向 `dev` 或 `main` 分支提交 Pull Request
- **功能**：构建 Docker 镜像但不推送，用于验证代码可构建性
- **作用**：作为合并前的质量门控

### 2. 版本发布 (`release.yml`)

- **触发条件**：在 `main` 分支上创建符合 `x.x.x` 格式的标签
- **功能**：构建并推送 Docker 镜像到 DockerHub
- **推送标签**：版本标签 + `latest` 标签

## 🔐 必需的 GitHub Secrets

在仓库设置中配置以下 Secrets：

```
DOCKERHUB_USERNAME = ding113
DOCKERHUB_TOKEN = <your-dockerhub-access-token>
```

### 获取 DockerHub Token

1. 登录 [Docker Hub](https://hub.docker.com)
2. Account Settings → Security
3. New Access Token → 创建具有 `Read & Write` 权限的 Token

## 🛡️ 分支保护规则配置

### 为 `dev` 分支设置保护规则

1. 进入仓库 Settings → Branches
2. Add rule → Branch name pattern: `dev`
3. 配置以下选项：

   **必选项：**
   - [x] Require a pull request before merging
   - [x] Require status checks to pass before merging
     - 搜索并选择：`Docker Build Test`
   - [x] Require branches to be up to date before merging

   **可选项（根据团队需求）：**
   - [ ] Require approvals (需要审核批准)
   - [ ] Dismiss stale pull request approvals when new commits are pushed
   - [ ] Require review from CODEOWNERS

4. Create 保存规则

### 为 `main` 分支设置保护规则

1. Add rule → Branch name pattern: `main`
2. 配置以下选项：

   **必选项：**
   - [x] Require a pull request before merging
   - [x] Require status checks to pass before merging
     - 搜索并选择：`Docker Build Test`
   - [x] Require branches to be up to date before merging
   - [x] Include administrators (管理员也需要遵守规则)

   **推荐选项：**
   - [x] Require approvals (数量：1-2)
   - [x] Require conversation resolution before merging
   - [x] Do not allow bypassing the above settings

3. Create 保存规则

## 🔄 工作流程示例

### 1. 功能开发流程

```bash
# 1. 创建功能分支
git checkout -b feature/new-feature

# 2. 开发并提交代码
git add .
git commit -m "feat: add new feature"
git push origin feature/new-feature

# 3. 创建 PR 到 dev 分支
# GitHub 会自动运行构建检查

# 4. 构建通过后，合并到 dev
```

### 2. 发布流程

```bash
# 1. 从 dev 合并到 main
git checkout main
git merge dev
git push origin main

# 2. 创建版本标签
git tag 1.0.0
git push origin 1.0.0

# 3. GitHub Actions 自动：
#    - 验证标签在 main 分支上
#    - 构建 Docker 镜像
#    - 推送到 DockerHub (1.0.0 + latest)
#    - 创建 GitHub Release
```

## 🐳 Docker 镜像使用

发布后，可以使用以下命令拉取镜像：

```bash
# 最新版本
docker pull ding113/claude-code-hub:latest

# 特定版本
docker pull ding113/claude-code-hub:1.0.0

# 运行容器
docker run -d \
  -p 4000:4000 \
  --env-file .env \
  ding113/claude-code-hub:latest
```

## ⚠️ 注意事项

1. **版本标签格式**：必须是 `x.x.x` 格式（如 `1.0.0`），可选 `v` 前缀（如 `v1.0.0`）
2. **分支策略**：
   - `feature/*` → `dev` (通过 PR)
   - `dev` → `main` (通过 PR)
   - 标签只在 `main` 分支创建
3. **缓存优化**：工作流使用 GitHub Actions 缓存加速构建
4. **多平台支持**：自动构建 `linux/amd64` 和 `linux/arm64` 架构

## 🚨 故障排除

### PR 构建失败

- 检查 Dockerfile 语法
- 查看 Actions 日志中的错误信息
- 确保所有依赖正确安装

### 无法推送到 DockerHub

- 验证 Secrets 配置正确
- 检查 DockerHub Token 权限
- 确认 DockerHub 仓库名称正确

### 标签发布未触发

- 确保标签格式正确（`x.x.x`）
- 确认标签在 `main` 分支上创建
- 检查 Actions 是否被禁用
