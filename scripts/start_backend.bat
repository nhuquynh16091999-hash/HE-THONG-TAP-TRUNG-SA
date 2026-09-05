@echo off
REM PM2/Manual wrapper for FAOS Backend API (Windows)
REM For leaders running on Windows

REM Auto-detect project root
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%.."
set PROJECT_ROOT=%cd%

REM Auto-detect virtualenv
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo ERROR: No virtualenv found in %PROJECT_ROOT%
    echo Looked for: .venv\Scripts\activate.bat, venv\Scripts\activate.bat
    exit /b 1
)

set PYTHONPATH=%PROJECT_ROOT%

echo === FAOS Backend Starting ===
echo   Project: %PROJECT_ROOT%
echo   Python:  %VIRTUAL_ENV%\Scripts\python.exe
echo ==============================

uvicorn faos_brain.api.main:app --host 0.0.0.0 --port 8000
