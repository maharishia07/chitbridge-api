@echo off
rem ChitBridge connector — double-click to start (Windows).
rem First run: asks for your key and where Tally listens, tests both, writes connector.json, runs the first sync.
rem Later runs: watches for orders (and re-reads products/stock on the schedule saved in connector.json).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)
findstr /c:"PASTE THE KEY" connector.json >nul 2>nul
if not errorlevel 1 goto setup
if not exist connector.json goto setup
node index.js watch --config connector.json
pause
exit /b 0
:setup
node setup.js
pause
