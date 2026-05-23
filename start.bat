@echo off
title Nanguo Agent Controller
echo ========================================
echo   Nanguo - Remote Browser Agent Backend
echo ========================================
echo.

cd /d "%~dp0"

if not exist "data" mkdir data

echo [1/2] Starting backend on http://0.0.0.0:8000
echo [2/2] Expose with: ngrok http 8000
echo.

set PYTHONPATH=%~dp0
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

pause
