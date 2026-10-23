@echo off
rem Ignition Level Tool: the level editor on http://localhost:8767/ (its viewer shows the editor's levels too)
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is needed: please install it from https://nodejs.org/ ^(version 18 or newer^).
  pause
  exit /b 1
)
node editor\server.js %*
if errorlevel 1 pause
