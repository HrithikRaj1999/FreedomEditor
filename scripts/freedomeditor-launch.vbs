Option Explicit

Dim shell, fileSystem, root, command, argument
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
root = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
command = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & root & "\scripts\freedomeditor.ps1"" -Action launch"
For Each argument In WScript.Arguments
	command = command & " """ & Replace(argument, """", "") & """"
Next
shell.Run command, 0, False