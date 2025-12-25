# tools/clean-dist-win.ps1
$ErrorActionPreference = "Stop"

Write-Host "== Clean build (Windows) =="

# 1) Clean workspace
if (Test-Path "node_modules") { Remove-Item -Recurse -Force "node_modules" }
if (Test-Path "package-lock.json") { Remove-Item -Force "package-lock.json" }

# Next build artifacts
if (Test-Path ".next") { Remove-Item -Recurse -Force ".next" }
if (Test-Path "out") { Remove-Item -Recurse -Force "out" }

# Electron packaging artifacts
if (Test-Path "dist") {
  try { Remove-Item -Recurse -Force "dist" -ErrorAction Stop }
  catch { cmd /c "rmdir /s /q dist" | Out-Null }
}
if (Test-Path "release") {
  try {
    Remove-Item -Recurse -Force "release" -ErrorAction Stop
  } catch {
    Write-Host "Cleanup: Remove-Item failed for release/, retrying with cmd rmdir..."
    cmd /c "rmdir /s /q release" | Out-Null
  }
}

# Puppeteer cache folder (the one we ship)
if (Test-Path ".puppeteer") { Remove-Item -Recurse -Force ".puppeteer" }

Write-Host "== Install dependencies =="
# Ensure puppeteer downloads its browser into the repo so it can be packaged
$env:PUPPETEER_CACHE_DIR = ".puppeteer"
# This downloads Chrome for Testing (what Puppeteer expects) into the cache dir.
npx --yes puppeteer browsers install chrome
npm install

Write-Host "== Rebuild native deps for Electron =="
npx electron-builder install-app-deps

Write-Host "== Build Next + assemble Electron resources =="
npm run build
node ./tools/prepare-electron.mjs

Write-Host "== Build Windows NSIS installer =="
npx electron-builder --win nsis

Write-Host "== Done =="
Write-Host "Check ./release for the installer (.exe)"
