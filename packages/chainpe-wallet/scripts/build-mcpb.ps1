# PowerShell build script for Windows
$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$BUILD_DIR = Join-Path $ROOT_DIR ".mcpb-build"
$OUTPUT = Join-Path $ROOT_DIR "chainpe.mcpb"

Write-Host "Building ChainPe desktop extension..." -ForegroundColor Cyan

# 1. Clean
if (Test-Path $BUILD_DIR) { Remove-Item -Recurse -Force $BUILD_DIR }
if (Test-Path $OUTPUT) { Remove-Item -Force $OUTPUT }
New-Item -ItemType Directory -Path "$BUILD_DIR/server" -Force | Out-Null

# 2. Build TypeScript
Write-Host "Compiling TypeScript..." -ForegroundColor Yellow
Set-Location $ROOT_DIR
# Run the package's own build script: in an npm workspace the tsup binary lives in the repo root's
# node_modules, not in this package's, so a hardcoded node_modules/.bin/tsup path does not exist.
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }

# 3. Copy server bundle
Copy-Item "$ROOT_DIR/dist/index.js" "$BUILD_DIR/server/index.js"

# 4. Remove shebang from index.js
node (Join-Path $PSScriptRoot "strip-shebang.mjs") "$BUILD_DIR/server/index.js"
if ($LASTEXITCODE -ne 0) { throw "strip-shebang failed" }

# 5. Install production dependencies
Write-Host "Installing production dependencies..." -ForegroundColor Yellow
# The workspace SDK is bundled into dist/index.js (tsup noExternal), so drop it here.
$pkg = Get-Content "$ROOT_DIR/package.json" -Raw | ConvertFrom-Json
$pkg.dependencies.PSObject.Properties.Remove('@chainpemonad/sdk')
$pkg.PSObject.Properties.Remove('devDependencies')
$pkg | ConvertTo-Json -Depth 10 | Set-Content "$BUILD_DIR/server/package.json"
Set-Location "$BUILD_DIR/server"
npm install --omit=dev --ignore-scripts --legacy-peer-deps
if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
Remove-Item "package.json", "package-lock.json" -ErrorAction SilentlyContinue

# 6. Prune node_modules
Write-Host "Pruning unnecessary files..." -ForegroundColor Yellow
Remove-Item "node_modules/typescript" -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "node_modules" -Recurse -Include "*.map" | Remove-Item -Force
Get-ChildItem -Path "node_modules" -Recurse -Include "*.ts" -Exclude "*.d.ts" | Remove-Item -Force
Get-ChildItem -Path "node_modules" -Recurse -Include "CHANGELOG*", "HISTORY*", ".eslintrc*", ".prettierrc*", "tsconfig*.json", ".npmignore" | Remove-Item -Force
Get-ChildItem -Path "node_modules" -Recurse -Directory -Include "__tests__", "tests", "docs", "examples" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Remove CJS from ESM-first deps
if (Test-Path "node_modules/viem/_cjs") { Remove-Item "node_modules/viem/_cjs" -Recurse -Force }
if (Test-Path "node_modules/ox/_cjs") { Remove-Item "node_modules/ox/_cjs" -Recurse -Force }

# 7. Copy manifest and icon
Set-Location $BUILD_DIR
Copy-Item "$ROOT_DIR/manifest.json" "manifest.json"
if (Test-Path "$ROOT_DIR/chainpe-logo.png") {
    Copy-Item "$ROOT_DIR/chainpe-logo.png" "chainpe-logo.png"
}

# 8. Pack
Write-Host "Packing .mcpb bundle..." -ForegroundColor Yellow
# tar.exe (built into Windows 10+) writes a standard zip with forward-slash paths; Windows PowerShell 5's
# Compress-Archive writes backslash paths that some unzip tools reject.
$tempZip = Join-Path $ROOT_DIR "chainpe.zip"
if (Test-Path $tempZip) { Remove-Item -Force $tempZip }
tar.exe -a -c -f $tempZip -C $BUILD_DIR .
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
Move-Item $tempZip $OUTPUT -Force

# 9. Clean up
Set-Location $ROOT_DIR
Start-Sleep -Milliseconds 500
Remove-Item -Recurse -Force $BUILD_DIR -ErrorAction SilentlyContinue

$size = (Get-Item $OUTPUT).Length / 1MB
Write-Host ""
Write-Host "Done! Created: $OUTPUT ($([math]::Round($size, 2)) MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Install in Claude Desktop:" -ForegroundColor Cyan
Write-Host "  - Double-click chainpe.mcpb"
Write-Host "  - Or drag it into Claude Desktop settings"
