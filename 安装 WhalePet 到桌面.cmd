@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-WhalePet-Shortcut.ps1"
if errorlevel 1 (
  echo.
  echo 安装没有完成，请把这个窗口的错误截图发给你的朋友。
)
echo.
pause
