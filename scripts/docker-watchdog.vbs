' Launch the Botifyr Docker watchdog with no visible console window.
' Called by the \BotifyrDockerWatchdog scheduled task via wscript.exe.
' The trailing 0 = hidden window; False = don't wait for it to exit.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""G:\Developments\botifyr.xyz\scripts\docker-watchdog.ps1"" -Quiet", 0, False
