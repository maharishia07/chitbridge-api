@echo off
rem ============================================================================
rem  THE COUNTER. Double-click this to bill.
rem
rem  NOTE: start.cmd is a DIFFERENT program. It runs the CONNECTOR, which syncs
rem  Tally/Zoho in the background and shows no shop at all. Athi, setting one up
rem  on 2026-09-19: "i removed and again i was trying to run the start, i am not
rem  getting the shop in the desktop" - and he never would have, because the kit
rem  shipped a launcher for the connector and none for the counter. This is it.
rem
rem  ASCII ONLY, DELIBERATELY. cmd.exe reads a .cmd in the system codepage, not
rem  UTF-8: the first version of this file had box-drawing and emoji in these rem
rem  lines, which arrived as mojibake and were then run as COMMANDS. A comment
rem  broke the program. Keep every byte in this file plain ASCII.
rem
rem    already running -> opens the browser at it; a second start is not an error
rem    not running     -> starts it, waits for it to answer, then opens the page
rem ============================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this PC. Double-click start.cmd once - it installs Node.js for you.
  pause
  exit /b 1
)

if not exist "%~dp0till.js" (
  echo This file is not beside the rest of the kit - Windows ran it from inside the zip.
  echo Extract the zip first, then double-click counter.cmd in the extracted folder.
  pause
  exit /b 1
)

rem The config carries the key. Without one the counter still opens and says what
rem it needs - a counter that will not open cannot tell anybody why.
if not exist connector.json (
  echo No connector.json yet. Double-click start.cmd once to set the key up, then come back here.
  pause
  exit /b 1
)

rem ALREADY UP? Then this is not a failure - open it. The scheduled task fires
rem every five minutes, so a second start is an ordinary event, not a fault.
netstat -ano | findstr /c:"127.0.0.1:7071" | findstr /i "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo The counter is already running - opening it.
  start "" "http://127.0.0.1:7071"
  exit /b 0
)

echo Starting the counter...
start "ChitBridge counter" /min cmd /c "node till.js --config connector.json >> till.log 2>&1"

rem WAIT FOR IT TO ANSWER before opening the browser. Opening too early shows
rem "cannot reach this page", which reads as a broken counter on a machine where
rem nothing is wrong.
set /a tries=0
:wait
set /a tries+=1
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr /c:"127.0.0.1:7071" | findstr /i "LISTENING" >nul 2>nul
if not errorlevel 1 goto ready
if %tries% lss 15 goto wait

echo The counter did not start. What it said is in till.log:
if exist till.log powershell -NoProfile -Command "Get-Content till.log -Tail 10"
pause
exit /b 1

:ready
echo The counter is ready.
start "" "http://127.0.0.1:7071"
exit /b 0
