[CmdletBinding()]
param(
	[ValidateSet('configure', 'check', 'update', 'pause', 'resume', 'status')]
	[string]$Action = 'status',
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$UpdateArguments
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sourceConfig = Join-Path $root '.freedomeditor\config.json'
if (-not (Test-Path -LiteralPath $sourceConfig)) {
	throw 'Initialize the FreedomEditor source toolchain before configuring source-based automatic updates.'
}
$node = (Get-Content -LiteralPath $sourceConfig -Raw | ConvertFrom-Json).nodePath
if (-not $node -or -not (Test-Path -LiteralPath $node -PathType Leaf)) {
	throw 'The configured Node.js build tool was not found.'
}
& $node (Join-Path $PSScriptRoot 'freedomeditor-auto-update.mjs') $Action @UpdateArguments
exit $LASTEXITCODE
