@echo off
cd /d "%~dp0"
echo Installing dependencies...
npm.cmd install
if errorlevel 1 (
  echo Install failed.
  pause
  exit /b 1
)
echo Starting server on port 3000...
node server.js
pause
