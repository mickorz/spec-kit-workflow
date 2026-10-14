# SDD Workflow Pack 环境搭建脚本
# 验证 Junction 引擎、构建状态和插件入口

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot
$enginePath = Join-Path $projectRoot "thirdparties\opencode-dynamic-workflows"
$engineSource = "E:\WorkProjects\opencode-dynamic-workflows"

Write-Host "[1/4] 检查引擎 Junction..."
if (-not (Test-Path $enginePath)) {
    Write-Host "  Junction 不存在，正在创建..."
    if (Test-Path $engineSource) {
        New-Item -ItemType Junction -Path $enginePath -Target $engineSource -Force | Out-Null
        Write-Host "  [OK] Junction 已创建"
    } else {
        Write-Host "  [FAIL] 引擎源目录不存在: $engineSource"
        Write-Host "  请先克隆 opencode-dynamic-workflows 仓库"
        exit 1
    }
} else {
    Write-Host "  [OK] Junction 已存在"
}

Write-Host "[2/4] 检查引擎构建产物..."
$distIndex = Join-Path $enginePath "dist\index.js"
if (-not (Test-Path $distIndex)) {
    Write-Host "  dist/index.js 不存在，正在构建..."
    Push-Location $enginePath
    npm run build
    Pop-Location
    if (-not (Test-Path $distIndex)) {
        Write-Host "  [FAIL] 构建后仍无 dist/index.js"
        exit 1
    }
    Write-Host "  [OK] 构建完成"
} else {
    Write-Host "  [OK] dist/index.js 已存在"
}

Write-Host "[3/4] 检查引擎依赖..."
$nodeModules = Join-Path $enginePath "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "  node_modules 不存在，正在安装..."
    Push-Location $enginePath
    npm install
    Pop-Location
    Write-Host "  [OK] 依赖安装完成"
} else {
    Write-Host "  [OK] node_modules 已存在"
}

Write-Host "[4/4] 验证插件入口..."
try {
    $entryContent = Get-Content $distIndex -Raw -ErrorAction Stop
    if ($entryContent -match 'opencode-dynamic-workflows') {
        Write-Host "  [OK] 插件入口验证通过"
    } else {
        Write-Host "  [WARN] 插件入口内容未包含预期标识，请检查构建"
    }
} catch {
    Write-Host "  [WARN] 无法读取 dist/index.js，请检查构建"
}

Write-Host ""
Write-Host "环境搭建完成。"
Write-Host "在项目根目录启动 OpenCode 即可加载 Dynamic Workflows 插件。"
Write-Host "验证命令: opencode run '只回复 ok'"
