@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo WhalePet needs its local Electron files.
  echo Run: npm install
  pause
  exit /b 1
)
call npm start
