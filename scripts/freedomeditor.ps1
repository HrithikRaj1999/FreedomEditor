[CmdletBinding()]
param(
	[ValidateSet('init', 'status', 'check', 'update', 'sync', 'launch', 'extensions', 'rollback', 'schedule')]
	[string]$Action = 'launch',
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$EditorArguments
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configurationPath = Join-Path $root '.freedomeditor\config.json'
$node = $null
if (Test-Path -LiteralPath $configurationPath) {
	$config = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
	$node = $config.nodePath
}
if (-not $node -or -not (Test-Path -LiteralPath $node)) {
	$command = Get-Command node -ErrorAction SilentlyContinue
	if ($command) { $node = $command.Source }
}
if (-not $node) {
	throw 'Node.js was not found. Build contributors need the version in .nvmrc. Windows installer users do not need Node.js.'
}
if ($Action -eq 'schedule') {
	$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Action update --auto' -f $PSCommandPath
	$taskAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments -WorkingDirectory $root
	$trigger = New-ScheduledTaskTrigger -Daily -At '12:00'
	$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
	$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)
	Register-ScheduledTask -TaskName 'FreedomEditor Stable Updates' -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Check official stable VS Code source and stage validated FreedomEditor updates.' -Force | Out-Null
	Write-Output 'Daily, current-user update task registered. No administrator privileges or password were requested.'
	exit 0
}

& $node (Join-Path $PSScriptRoot 'freedomeditor-sync.mjs') $Action @EditorArguments
exit $LASTEXITCODE