Option Explicit

Dim shell, processEnvironment, executable, arguments
Set shell = CreateObject("WScript.Shell")
Set processEnvironment = shell.Environment("PROCESS")

processEnvironment("NODE_ENV") = "development"
processEnvironment("VSCODE_DEV") = "1"
processEnvironment("VSCODE_CLI") = "1"

shell.CurrentDirectory = "C:\FreedomEditor"
executable = "C:\FreedomEditor\.build\electron\FreedomEditor.exe"
arguments = """C:\FreedomEditor""" & _
    " --user-data-dir=""C:\FreedomEditorProfile""" & _
    " --extensions-dir=""C:\FreedomEditorExtensions""" & _
    " --disable-extension=vscode.vscode-api-tests" & _
    " --extensionDevelopmentPath=""C:\Users\z0054a6h\AppData\Local\Programs\Microsoft VS Code\645f29cc31\resources\app\extensions\copilot""" & _
    " ""C:\Team Center\tc-luma-integration\luma_mcp_chatbot_repo"""

shell.Run """" & executable & """ " & arguments, 1, False