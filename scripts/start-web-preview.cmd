@echo off
setlocal

if "%LIBRARY_PORT%"=="" set "LIBRARY_PORT=8080"
if not "%~1"=="" set "LIBRARY_PORT=%~1"

where deno >nul 2>nul
if errorlevel 1 (
  echo Library Web Preview needs Deno 2.9.6 or newer.
  echo Install Deno from https://deno.com/ and run this script again.
  exit /b 1
)

deno run --allow-all "%~dp0deno\src\main.ts" %LIBRARY_PORT%
exit /b %errorlevel%
