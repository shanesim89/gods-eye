@echo off
REM PDH/PDL Break+Retest — 4H levels (period_min=240). Separate state/journal/key.
REM Scheduled via Task Scheduler alongside daily (1440) instance.
cd /d "%~dp0"

taskkill /F /FI "WINDOWTITLE eq pdhl_4h_live" >nul 2>&1

"C:\Python314\python.exe" -u -m goldscalp.pdhl_live --period 240 >> "%~dp0goldscalp\data\pdhl_4h_live.log" 2>&1
