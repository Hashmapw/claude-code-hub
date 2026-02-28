# E2E 测试运行脚本（PowerShell 版本）
#
# 功能：
# 1. 启动 Next.js 开发服务器
# 2. 等待服务器就绪
# 3. 运行 E2E 测试
# 4. 清理并停止服务器
#
# 使用方法：
#   .\scripts\run-e2e-tests.ps1

$ErrorActionPreference = "Stop"

Write-Host "🚀 E2E 测试运行脚本" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan
Write-Host ""

# ==================== 1. 检查数据库连接 ====================

Write-Host "🔍 检查数据库连接..." -ForegroundColor Cyan
$postgresRunning = docker ps | Select-String "claude-code-hub-db-dev"

if ($postgresRunning) {
    Write-Host "✅ PostgreSQL 已运行" -ForegroundColor Green
} else {
    Write-Host "❌ PostgreSQL 未运行，正在启动..." -ForegroundColor Yellow
    docker compose up -d postgres redis
    Write-Host "⏳ 等待数据库启动..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

Write-Host ""

# ==================== 2. 启动开发服务器 ====================

Write-Host "🚀 启动 Next.js 开发服务器..." -ForegroundColor Cyan

# 后台启动服务器
$env:PORT = "4000"
$serverProcess = Start-Process -FilePath "bun" -ArgumentList "run", "dev" -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\nextjs-dev.log" -RedirectStandardError "$env:TEMP\nextjs-dev-error.log"

Write-Host "   服务器 PID: $($serverProcess.Id)" -ForegroundColor Gray
Write-Host "⏳ 等待服务器就绪..." -ForegroundColor Yellow

# 等待服务器启动（最多等待 60 秒）
$timeout = 60
$counter = 0
$serverReady = $false

while ($counter -lt $timeout) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/api/actions/health" -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host ""
            Write-Host "✅ 服务器已就绪" -ForegroundColor Green
            $serverReady = $true
            break
        }
    } catch {
        # 继续等待
    }

    $counter++
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 1
}

if (-not $serverReady) {
    Write-Host ""
    Write-Host "❌ 服务器启动超时" -ForegroundColor Red
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""

# ==================== 3. 运行 E2E 测试 ====================

Write-Host "🧪 运行 E2E 测试..." -ForegroundColor Cyan
Write-Host ""

# 设置环境变量
$env:API_BASE_URL = "http://localhost:4000/api/actions"
$env:AUTO_CLEANUP_TEST_DATA = "true"

# 运行 E2E 测试
$testExitCode = 0
try {
    bun run test tests/e2e/
    $testExitCode = $LASTEXITCODE
} catch {
    $testExitCode = 1
}

Write-Host ""

# ==================== 4. 清理并停止服务器 ====================

Write-Host "🧹 停止开发服务器..." -ForegroundColor Cyan
Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
Write-Host "✅ 服务器已停止" -ForegroundColor Green
Write-Host ""

# ==================== 5. 输出测试结果 ====================

if ($testExitCode -eq 0) {
    Write-Host "✅ E2E 测试全部通过" -ForegroundColor Green
    exit 0
} else {
    Write-Host "❌ E2E 测试失败" -ForegroundColor Red
    exit $testExitCode
}
