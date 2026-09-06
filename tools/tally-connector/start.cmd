@echo off
rem ChitBridge connector — double-click. This is the whole installation.
rem   no Node.js on this PC  -> installs it (winget, else the official MSI)
rem   first run              -> setup (the key came inside the download; a few questions about Tally), first product sync,
rem                             registers a Windows task so the watcher restarts on its own, then starts watching
rem   later runs             -> just watches for orders
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 call :getnode
if errorlevel 1 exit /b 1
if not exist connector.json goto setup
findstr /c:"\"configured\": false" connector.json >nul 2>nul
if not errorlevel 1 goto setup
findstr /c:"PASTE THE KEY" connector.json >nul 2>nul
if not errorlevel 1 goto setup
node index.js watch --config connector.json
pause
exit /b 0

:setup
node setup.js
if errorlevel 1 (
  echo Setup did not finish. Fix what it printed and double-click start.cmd again.
  pause
  exit /b 1
)
node index.js install --config connector.json
echo.
echo Installed. Windows now keeps the connector running on its own (it is checked every 5 minutes). Starting it now - you may close this window later.
node index.js watch --config connector.json
pause
exit /b 0

:getnode
echo Node.js is not on this PC. Installing it once (this needs your OK on the Windows prompt)...
where winget >nul 2>nul
if not errorlevel 1 winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
if not exist "%ProgramFiles%\nodejs\node.exe" (
  echo Fetching the official installer from nodejs.org ...
  curl -L -o "%TEMP%\node-lts.msi" https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi
  start /wait msiexec /i "%TEMP%\node-lts.msi" /passive /norestart
)
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  echo Node.js installed.
  exit /b 0
)
echo Could not install Node.js automatically. Install the LTS from https://nodejs.org and double-click start.cmd again.
pause
exit /b 1
