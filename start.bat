@echo off
REM ITC Maintenance System - start the backend server and open the browser
REM Run from the repository root: start.bat

cd /d "%~dp0"

REM Try Python 3 from the standard installation locations
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python server/app.py --open
    exit /b %ERRORLEVEL%
)

where python3 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python3 server/app.py --open
    exit /b %ERRORLEVEL%
)

where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    py server/app.py --open
    exit /b %ERRORLEVEL%
)

echo Python was not found on PATH.  Install Python 3.9 or later and try again.
pause
exit /b 1
