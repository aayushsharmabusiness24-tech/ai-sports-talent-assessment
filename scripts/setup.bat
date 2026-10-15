@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title Setup - AI Sports Talent Assessment

echo.
echo ============================================================
echo   AI Sports Talent Assessment Platform - Setup
echo ============================================================
echo.

REM ---------- 1. Node.js ----------
echo [1/7] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 goto :no_node
node -e "process.exit(parseInt(process.versions.node)>=18?0:1)"
if errorlevel 1 goto :old_node
for /f "delims=" %%v in ('node -v') do echo         Found Node.js %%v

REM ---------- 2. Python ----------
echo [2/7] Checking Python 3.10 - 3.12...
set "PY_CMD="
for %%V in (3.12 3.11 3.10) do (
  if not defined PY_CMD (
    py -%%V -c "import sys" >nul 2>nul && set "PY_CMD=py -%%V"
  )
)
if not defined PY_CMD (
  python -c "import sys;sys.exit(0 if (3,10)<=sys.version_info[:2]<=(3,12) else 1)" >nul 2>nul && set "PY_CMD=python"
)
if not defined PY_CMD goto :no_python
for /f "delims=" %%v in ('%PY_CMD% --version') do echo         Using %%v  [%PY_CMD%]

REM ---------- 3. npm packages ----------
echo [3/7] Installing npm packages - root, backend, frontend. This can take a few minutes...
call npm install
if errorlevel 1 goto :npm_failed
call npm install --prefix backend
if errorlevel 1 goto :npm_failed
call npm install --prefix frontend
if errorlevel 1 goto :npm_failed

REM ---------- 4. Folders, .env, database ----------
echo [4/7] Preparing folders, backend\.env and the database...
if not exist "storage" mkdir "storage"
if not exist "storage\uploads" mkdir "storage\uploads"
if not exist "ai\model" mkdir "ai\model"
node backend\scripts\init.js
if errorlevel 1 goto :init_failed

REM ---------- 5. Python venv + packages ----------
echo [5/7] Creating Python virtual environment and installing packages...
if not exist "ai\venv\Scripts\python.exe" (
  %PY_CMD% -m venv ai\venv
  if errorlevel 1 goto :venv_failed
)
"ai\venv\Scripts\python.exe" -m pip install --upgrade pip
"ai\venv\Scripts\python.exe" -m pip install -r ai\requirements.txt
if errorlevel 1 goto :pip_failed

REM ---------- 6. Pose model ----------
echo [6/7] Checking the MediaPipe pose model...
set "MODEL_FILE=ai\model\pose_landmarker_full.task"
set "MODEL_URL=https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
if exist "%MODEL_FILE%" (
  echo         Model already present.
) else (
  echo         Downloading from the official MediaPipe model bucket...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%MODEL_URL%' -OutFile '%MODEL_FILE%.download' } catch { exit 1 }"
  if errorlevel 1 (
    if exist "%MODEL_FILE%.download" del "%MODEL_FILE%.download"
  ) else (
    move /y "%MODEL_FILE%.download" "%MODEL_FILE%" >nul
  )
)
if not exist "%MODEL_FILE%" goto :model_failed

REM ---------- 7. Verify AI environment ----------
echo [7/7] Verifying the AI environment...
"ai\venv\Scripts\python.exe" ai\main.py --check
if errorlevel 1 goto :verify_failed

echo.
echo ============================================================
echo   SETUP COMPLETE
echo   Next step: double-click scripts\start.bat
echo ============================================================
echo.
pause
exit /b 0

:no_node
echo.
echo [ERROR] Node.js was not found.
echo         Install Node.js 20 or 22 LTS from https://nodejs.org/ and run this script again.
pause
exit /b 1

:old_node
echo.
echo [ERROR] Your Node.js is too old. Install Node.js 20 or 22 LTS from https://nodejs.org/
pause
exit /b 1

:no_python
echo.
echo [ERROR] Python 3.10, 3.11 or 3.12 was not found.
echo         Install it from https://www.python.org/downloads/windows/
echo         and tick "Add python.exe to PATH" during installation. Python 3.13 is NOT supported.
pause
exit /b 1

:npm_failed
echo.
echo [ERROR] npm install failed. Check your internet connection and the messages above.
pause
exit /b 1

:init_failed
echo.
echo [ERROR] Could not initialise backend\.env or the database. See the messages above.
pause
exit /b 1

:venv_failed
echo.
echo [ERROR] Could not create the Python virtual environment.
pause
exit /b 1

:pip_failed
echo.
echo [ERROR] Installing Python packages failed. Check your internet connection and the messages above.
pause
exit /b 1

:model_failed
echo.
echo [ERROR] The pose model could not be downloaded automatically.
echo         Download this file in your browser:
echo         %MODEL_URL%
echo         and save it as:  ai\model\pose_landmarker_full.task
echo         Then run this setup again.
pause
exit /b 1

:verify_failed
echo.
echo [ERROR] The AI environment check failed. Read the problems listed above.
pause
exit /b 1