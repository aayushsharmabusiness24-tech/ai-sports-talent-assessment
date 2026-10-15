@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title AI Sports Talent Assessment

echo.
echo ============================================================
echo   AI Sports Talent Assessment Platform
echo ============================================================
echo.

if not exist "node_modules" goto :not_setup
if not exist "backend\node_modules" goto :not_setup
if not exist "frontend\node_modules" goto :not_setup
if not exist "backend\.env" goto :not_setup
if not exist "ai\venv\Scripts\python.exe" goto :not_setup
if not exist "ai\model\pose_landmarker_full.task" goto :not_setup

netstat -ano | findstr /R /C:":5000 .*LISTENING" >nul
if not errorlevel 1 goto :port_busy

echo   Backend API : http://localhost:5000/api/health
echo   Web app     : http://localhost:5173
echo.
echo   Open the Web app address in your browser.
echo   To STOP everything: press Ctrl+C in this window, then Y.
echo.

call npm run dev
echo.
echo Services stopped.
pause
exit /b 0

:not_setup
echo [ERROR] The project is not set up yet.
echo         Run scripts\setup.bat first, then start again.
pause
exit /b 1

:port_busy
echo [ERROR] Port 5000 is already in use - another program or an earlier run is still active.
echo         Close it, or change PORT in backend\.env and the proxy target in frontend\vite.config.js.
pause
exit /b 1