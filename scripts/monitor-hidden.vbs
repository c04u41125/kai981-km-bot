Option Explicit
Dim sh, root, command, result
Set sh = CreateObject("WScript.Shell")
root = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\KAI981Monitor"
command = """" & sh.ExpandEnvironmentStrings("%WINDIR%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & root & "\monitor-local.ps1"""
' WScript is a GUI process. Window style 0 is set BEFORE creating PowerShell.
result = sh.Run(command, 0, True)
WScript.Quit result
