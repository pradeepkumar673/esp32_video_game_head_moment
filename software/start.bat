@echo off
cd /d "%~dp0head-tracker-bridge"
start "Head Tracker Bridge" cmd /k node read_bridge.js COM6
cd /d "%~dp0head-tracker-ui"
start "Head Tracker UI" cmd /k npm run dev
timeout /t 5 >nul
start http://localhost:5173

