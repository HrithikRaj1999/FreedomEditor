[CmdletBinding()]
param(
	[switch]$SkipDependencies,
	[switch]$SkipCompile,
	[string]$NodePath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $NodePath) {
	$configPath = Join-Path $root '.freedomeditor\config.json'
	if (Test-Path -LiteralPath $configPath) {
		$NodePath = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).nodePath
	} else {
		$NodePath = (Get-Command node -ErrorAction Stop).Source
	}
}
$npm = Join-Path (Split-Path -Parent $NodePath) 'node_modules\npm\bin\npm-cli.js'
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$output = Join-Path $root '.freedomeditor\artifacts'
$packageRoot = Join-Path (Split-Path -Parent $root) 'VSCode-win32-x64'
$environmentPath = $env:PATH
$electronRunAsNode = $env:ELECTRON_RUN_AS_NODE

function Invoke-Node {
	param([string[]]$Arguments)
	& $NodePath @Arguments
	if ($LASTEXITCODE -ne 0) { throw "Build command failed with exit code $LASTEXITCODE." }
}

Push-Location $root
try {
	$env:PATH = "$(Split-Path -Parent $NodePath);$environmentPath"
	Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
	Invoke-Node -Arguments @($npm, '--prefix', 'freedomeditor', 'ci', '--ignore-scripts', '--no-audit', '--no-fund')
	Invoke-Node -Arguments @('--test', 'scripts/freedomeditor-sync.test.mjs', 'extensions/freedomeditor/extension.test.cjs')
	Invoke-Node -Arguments @('scripts/freedomeditor-brand.mjs')
	if (-not $SkipCompile) {
		if (Test-Path -LiteralPath $packageRoot) { throw "Packaging destination already exists: $packageRoot. Move it aside before building." }
		if (-not $SkipDependencies) { Invoke-Node -Arguments @($npm, 'ci') }
		Invoke-Node -Arguments @($npm, 'run', 'gulp', 'vscode-win32-x64-min')
	}
	$packagedProduct = Join-Path $packageRoot 'resources\app\product.json'
	if (-not (Test-Path -LiteralPath $packagedProduct)) { throw 'A complete production package was not created.' }
	if ((Get-Content -LiteralPath $packagedProduct -Raw | ConvertFrom-Json).nameShort -ne 'FreedomEditor') { throw 'Refusing to package a non-FreedomEditor application.' }
	$compiler = Join-Path $root 'node_modules\innosetup\bin\ISCC.exe'
	if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Inno Setup compiler is missing. Install the repository dependencies first.' }
	New-Item -ItemType Directory -Path $output -Force | Out-Null
	& $compiler "/DSourceDir=$packageRoot" "/DOutputDir=$output" "/DAppVersion=$version" "/DRepoDir=$root" (Join-Path $root 'freedomeditor\installer.iss')
	if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed with exit code $LASTEXITCODE." }
	$installer = Join-Path $output "FreedomEditorSetup-x64-$version.exe"
	$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
	[System.IO.File]::WriteAllText("$installer.sha256", "$hash  $([System.IO.Path]::GetFileName($installer))`n")
	Write-Output "Installer: $installer"
	Write-Output "SHA256: $hash"
} finally {
	$env:PATH = $environmentPath
	$env:ELECTRON_RUN_AS_NODE = $electronRunAsNode
	Pop-Location
}