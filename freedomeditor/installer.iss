#ifndef SourceDir
	#error SourceDir must point to a built FreedomEditor Windows application.
#endif
#ifndef AppVersion
	#define AppVersion "1.137.0"
#endif

[Setup]
AppId={{CC6B787D-37A0-49E8-AE24-8559A032BE0C}
AppName=FreedomEditor
AppVersion={#AppVersion}
AppPublisher=Hrithik Raj and the FreedomEditor community
AppPublisherURL=https://github.com/HrithikRaj1999/FreedomEditor
AppSupportURL=https://github.com/HrithikRaj1999/FreedomEditor/issues
AppUpdatesURL=https://github.com/HrithikRaj1999/FreedomEditor/releases
DefaultDirName={localappdata}\Programs\FreedomEditor
DefaultGroupName=FreedomEditor
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
OutputBaseFilename=FreedomEditorSetup-x64-{#AppVersion}
SetupIconFile={#RepoDir}\freedomeditor\assets\freedomeditor.ico
UninstallDisplayIcon={app}\FreedomEditor.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
LicenseFile={#RepoDir}\LICENSE.txt

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "codingextensions"; Description: "Install Python, TypeScript tools, Mermaid and PDF viewers (internet required)"; GroupDescription: "Coding tools:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoDir}\freedomeditor\extensions.json"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "{#RepoDir}\freedomeditor\install-extensions.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "{#RepoDir}\README.md"; DestDir: "{app}"; DestName: "FreedomEditor-README.md"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\FreedomEditor"; Filename: "{app}\FreedomEditor.exe"; AppUserModelID: "FreedomEditor"
Name: "{autodesktop}\FreedomEditor"; Filename: "{app}\FreedomEditor.exe"; Tasks: desktopicon; AppUserModelID: "FreedomEditor"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\tools\install-extensions.ps1"""; Tasks: codingextensions; Flags: runhidden waituntilterminated
Filename: "{app}\FreedomEditor.exe"; Description: "Open FreedomEditor"; Flags: nowait postinstall skipifsilent