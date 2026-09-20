@echo off
setlocal
cd /d "%~dp0"

set "DSH_TELEMETRY_MODE=DISABLED"
set "WHALEPET_DSH=%USERPROFILE%\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js"

if not exist "%WHALEPET_DSH%" (
  echo DeepSeek Harness was not found at:
  echo %WHALEPET_DSH%
  echo.
  echo Reinstall or repair DeepSeek Harness before starting WhalePet.
  pause
  exit /b 1
)

echo Starting WhalePet at http://127.0.0.1:3080
echo This launcher does not send a model request.
echo Press Ctrl+C here to stop it.
echo.

node "%WHALEPET_DSH%" --profile web

