@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Vitals

rem ---------------------------------------------------------------------------
rem  Lancador do Vitals (Windows).
rem
rem    Vitals.bat            abre o app (instala/compila na primeira vez)
rem    Vitals.bat --rebuild  forca npm run build antes de abrir
rem    Vitals.bat --dev      abre em modo desenvolvimento (HMR)
rem
rem  Requisitos: Node.js 22+ e PowerShell 7 (pwsh).
rem  Isto NAO e um executavel independente: usa o Electron de node_modules.
rem  Para um .exe portatil, veja docs/OPERATIONS.md (empacotamento).
rem ---------------------------------------------------------------------------

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Vitals] Node.js nao encontrado no PATH.
  echo          Instale Node.js 22 ou superior: https://nodejs.org
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Vitals] npm nao encontrado no PATH ^(instalacao do Node incompleta^).
  echo.
  pause
  exit /b 1
)

where pwsh >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Vitals] AVISO: PowerShell 7 ^(pwsh^) nao encontrado.
  echo          O app abre, mas sem processos/GPU por processo.
  echo          Instale com: winget install Microsoft.PowerShell
  echo.
  timeout /t 4 >nul
)

if not exist "%ELECTRON%" (
  echo [Vitals] Primeira execucao: instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo.
    echo [Vitals] Falha no npm install. Veja as mensagens acima.
    echo.
    pause
    exit /b 1
  )
)

if /i "%~1"=="--dev" (
  echo [Vitals] Modo desenvolvimento...
  call npm run dev
  exit /b %errorlevel%
)

set "NEED_BUILD="
if /i "%~1"=="--rebuild" set "NEED_BUILD=1"
if not exist "%~dp0out\main\index.js" set "NEED_BUILD=1"

if defined NEED_BUILD (
  echo [Vitals] Compilando...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [Vitals] Falha no build. Veja as mensagens acima.
    echo.
    pause
    exit /b 1
  )
)

if not exist "%~dp0out\renderer\index.html" (
  echo.
  echo [Vitals] Build incompleto: out\renderer\index.html nao existe.
  echo          Rode: Vitals.bat --rebuild
  echo.
  pause
  exit /b 1
)

echo [Vitals] Abrindo...
rem "." evita o problema de barra final em argumento citado (D:\Monitor\").
start "" /d "%~dp0" "%ELECTRON%" .
exit /b 0
