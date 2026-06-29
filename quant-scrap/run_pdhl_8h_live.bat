@echo off
REM PDH/PDL Break+Retest — 8H levels (period_min=480). Separate state/journal/key.
REM Scheduled via Task Scheduler alongside daily (1440) and 4H instances.
cd /d "%~dp0"

taskkill /F /FI "WINDOWTITLE eq pdhl_8h_live" >nul 2>&1

"C:\Python314\python.exe" -u -m goldscalp.pdhl_live --period 480 >> "%~dp0goldscalp\data\pdhl_8h_live.log" 2>&1
