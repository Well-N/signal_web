@echo off
rem SignalWeb dev launcher with the explicit sample brief (marked as 示例数据 in the UI)
cd /d "%~dp0desktop"
set SIGNALWEB_DEMO=1
start "" npm start

