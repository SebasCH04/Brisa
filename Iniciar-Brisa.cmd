@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 22 o posterior y vuelve a abrir Brisa.
  pause
  exit /b 1
)
if not exist "node_modules\qrcode" (
  call npm.cmd ci --omit=dev
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts/launch.mjs
if errorlevel 1 pause
