' run-hidden.vbs — START SOMETHING WITH NO WINDOW (Athi, 2026-09-07: "now and then the Windows PowerShell comes in front of the
' screen whenever the Tally or Zoho connector works — can it be silent? otherwise it is annoying and people will not use it").
'
' Task Scheduler starts the watcher, and the counter, every five minutes whenever they are not running. Started through cmd, that
' flashes a console window across whatever the shopkeeper is doing. WScript.Shell.Run with window style 0 starts the same command with
' no window at all, and waits for nothing (False), so the task itself finishes at once while node keeps running.
'
' Called as:  wscript.exe "<this file>" "<full path to connector.json>" "<log file name>" ["<what to run>"]
'   what to run defaults to the connector's watcher; the counter passes "till.js".
Option Explicit
Dim sh, here, cfg, logName, what, cmd
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
cfg = WScript.Arguments(0)
If WScript.Arguments.Count > 1 Then logName = WScript.Arguments(1) Else logName = "watch.log"
If WScript.Arguments.Count > 2 Then what = WScript.Arguments(2) Else what = "index.js watch"
sh.CurrentDirectory = here
cmd = "cmd /c node " & what & " --config """ & cfg & """ >> """ & here & logName & """ 2>&1"
sh.Run cmd, 0, False
