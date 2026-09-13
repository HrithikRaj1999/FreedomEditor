#ifndef SourceDir
	#error SourceDir must point to a built FreedomEditor Windows application.
#endif
#ifndef AppVersion
	#define AppVersion "1.137.0"
#endif
#ifndef LongestRuntimeRelativePath
	#error LongestRuntimeRelativePath must be computed by freedomeditor-build.ps1.
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
ChangesAssociations=yes
LicenseFile={#RepoDir}\LICENSE.txt

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
Name: "codingextensions"; Description: "Install Python, TypeScript tools, Mermaid and PDF viewers (internet required)"; GroupDescription: "Coding tools:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "*.js.map,*.mjs.map,*.cjs.map,*.css.map,*.ts.map,*.mts.map,*.cts.map"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RepoDir}\freedomeditor\extensions.json"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "{#RepoDir}\freedomeditor\install-extensions.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "{#RepoDir}\README.md"; DestDir: "{app}"; DestName: "FreedomEditor-README.md"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\FreedomEditor"; Filename: "{app}\FreedomEditor.exe"; AppUserModelID: "FreedomEditor"
Name: "{autodesktop}\FreedomEditor"; Filename: "{app}\FreedomEditor.exe"; Tasks: desktopicon; AppUserModelID: "FreedomEditor"

[Registry]
Root: HKCU; Subkey: "Software\Classes\freedomeditor"; ValueType: string; ValueName: ""; ValueData: "URL:FreedomEditor"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\freedomeditor"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\freedomeditor\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\FreedomEditor.exe,0"
Root: HKCU; Subkey: "Software\Classes\freedomeditor\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\FreedomEditor.exe"" --open-url -- ""%1"""

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\tools\install-extensions.ps1"""; Tasks: codingextensions; Flags: runhidden waituntilterminated
Filename: "{app}\FreedomEditor.exe"; Description: "Open FreedomEditor"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if Length(ExpandConstant('{app}')) + {#LongestRuntimeRelativePath} >= 260 then
    Result := 'The installation folder is too long for this Windows package. Choose a shorter folder and retry. Your profile will not be moved.';
end;