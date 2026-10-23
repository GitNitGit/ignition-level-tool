@echo off
rem Ignition Level Tool: the level viewer (original levels) on http://localhost:8765/
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is needed: please install it from https://nodejs.org/ ^(version 18 or newer^).
  pause
  exit /b 1
)
node editor\server.js --viewer %*
if errorlevel 1 pause
