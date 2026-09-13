[CmdletBinding()]
param([string]$InstallRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$cli = Join-Path $InstallRoot 'bin\freedomeditor.cmd'
$extensions = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'extensions.json') -Raw | ConvertFrom-Json
$logRoot = Join-Path $env:LOCALAPPDATA 'FreedomEditor'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Transcript -Path (Join-Path $logRoot 'extension-install.log') -Append | Out-Null
try {
	$arguments = @()
	foreach ($extension in $extensions) { $arguments += @('--install-extension', $extension) }
	& $cli @arguments
	if ($LASTEXITCODE -ne 0) { throw 'Some coding tools could not be installed. Retry this script when connected, or install them from Extensions inside FreedomEditor.' }
} finally {
	Stop-Transcript | Out-Null
}