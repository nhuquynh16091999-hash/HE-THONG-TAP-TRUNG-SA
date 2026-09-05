@echo off
cd /d D:\Stramark_ver2
echo [%date% %time%] Starting Status Audit >> logs\scheduler.log
python sync\stramark\status_audit.py >> logs\scheduler.log 2>&1
echo [%date% %time%] Status Audit completed (exit code: %ERRORLEVEL%) >> logs\scheduler.log
