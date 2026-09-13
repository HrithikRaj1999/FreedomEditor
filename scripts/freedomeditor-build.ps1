[CmdletBinding()]
param(
	[switch]$SkipDependencies,
	[switch]$SkipCompile,
	[string]$NodePath,
	[string]$SignToolPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$signToolDirectory = $null
if (-not $SkipCompile) {
	if (-not $SignToolPath) {
		$signToolCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue
		if ($signToolCommand) { $SignToolPath = $signToolCommand.Source }
	}
	if (-not $SignToolPath) {
		$sdkRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
		if (Test-Path -LiteralPath $sdkRoot -PathType Container) {
			$signTool = Get-ChildItem -LiteralPath $sdkRoot -Filter 'signtool.exe' -File -Recurse |
				Where-Object { $_.FullName -match '\\(x64|x86)\\signtool\.exe$' } |
				Sort-Object -Property @{ Expression = { $_.Directory.Parent.Name -as [version] }; Descending = $true }, @{ Expression = { $_.Directory.Name -eq 'x64' }; Descending = $true } |
				Select-Object -First 1
			if ($signTool) { $SignToolPath = $signTool.FullName }
		}
	}
	if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) {
		throw 'Windows SDK SignTool is required. Install the Windows SDK, add signtool.exe to PATH, or pass -SignToolPath with the executable from Microsoft.Windows.SDK.BuildTools. No build was started.'
	}
	$SignToolPath = (Resolve-Path -LiteralPath $SignToolPath).Path
	$signToolDirectory = Split-Path -Parent $SignToolPath
}
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
$previousSignToolPath = $env:SIGNTOOL_PATH

function Invoke-Node {
	param([string[]]$Arguments)
	& $NodePath @Arguments
	if ($LASTEXITCODE -ne 0) { throw "Build command failed with exit code $LASTEXITCODE." }
}

Push-Location $root
try {
	$env:PATH = (@((Split-Path -Parent $NodePath), $signToolDirectory, $environmentPath) | Where-Object { $_ }) -join ';'
	if (-not $SkipCompile) { $env:SIGNTOOL_PATH = $SignToolPath }
	Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
	if (-not $SkipDependencies) {
		Invoke-Node -Arguments @($npm, '--prefix', 'freedomeditor', 'ci', '--ignore-scripts', '--no-audit', '--no-fund')
	}
	Invoke-Node -Arguments @($npm, '--prefix', 'freedomeditor', 'test')
	Invoke-Node -Arguments @('scripts/freedomeditor-brand.mjs')
	if (-not $SkipCompile) {
		if (Test-Path -LiteralPath $packageRoot) { throw "Packaging destination already exists: $packageRoot. Move it aside before building." }
		if (-not $SkipDependencies) { Invoke-Node -Arguments @($npm, 'ci') }
		Invoke-Node -Arguments @('scripts/freedomeditor-sdk.mjs')
		Invoke-Node -Arguments @($npm, 'run', 'gulp', 'vscode-win32-x64-min')
	}
	$packagedProduct = Join-Path $packageRoot 'resources\app\product.json'
	if (-not (Test-Path -LiteralPath $packagedProduct)) { throw 'A complete production package was not created.' }
	if ((Get-Content -LiteralPath $packagedProduct -Raw | ConvertFrom-Json).nameShort -ne 'FreedomEditor') { throw 'Refusing to package a non-FreedomEditor application.' }
	if ((Get-Content -LiteralPath (Join-Path $packageRoot 'resources\app\package.json') -Raw | ConvertFrom-Json).version -ne $version) {
		throw 'The production package version differs from this source checkout. Rebuild before creating the installer.'
	}
	foreach ($relative in @('FreedomEditor.exe', 'resources\app\out\main.js', 'resources\app\out\vs\workbench\workbench.desktop.main.js', 'resources\app\out\vs\workbench\workbench.desktop.main.css', 'bin\freedomeditor.cmd')) {
		if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $relative) -PathType Leaf)) { throw "Incomplete production package: $relative is missing." }
	}
	$executableInfo = (Get-Item -LiteralPath (Join-Path $packageRoot 'FreedomEditor.exe')).VersionInfo
	if ($executableInfo.ProductName -ne 'FreedomEditor' -or $executableInfo.FileDescription -ne 'FreedomEditor') {
		throw 'The production executable still has incorrect Windows branding.'
	}
	foreach ($extension in @('freedomeditor', 'github-authentication', 'copilot')) {
		$extensionRoot = Join-Path $packageRoot "resources\app\extensions\$extension"
		$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
		if (-not $manifest.main) { throw "Incomplete desktop extension: $extension has no entry point." }
		Invoke-Node -Arguments @('--input-type=commonjs', '--eval', 'require.resolve(process.argv[1]);', (Join-Path $extensionRoot $manifest.main))
	}
	Invoke-Node -Arguments @('scripts/freedomeditor-auto-update.mjs', 'bootstrap', '--install-root', $packageRoot)
	$compiler = Join-Path $root 'node_modules\innosetup\bin\ISCC.exe'
	if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Inno Setup compiler is missing. Install the repository dependencies first.' }
	$longestRuntimeRelativePath = (Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
		Where-Object { $_.Name -notmatch '\.(js|mjs|cjs|css|ts|mts|cts)\.map$' } |
		ForEach-Object { $_.FullName.Length - $packageRoot.Length } |
		Measure-Object -Maximum).Maximum
	if ($packageRoot.Length + $longestRuntimeRelativePath -ge 260) {
		throw 'The package staging path is too long for Inno Setup. Use a shorter source checkout or automatic-update build root.'
	}
	New-Item -ItemType Directory -Path $output -Force | Out-Null
	& $compiler "/DSourceDir=$packageRoot" "/DOutputDir=$output" "/DAppVersion=$version" "/DRepoDir=$root" "/DLongestRuntimeRelativePath=$longestRuntimeRelativePath" (Join-Path $root 'freedomeditor\installer.iss')
	if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed with exit code $LASTEXITCODE." }
	$installer = Join-Path $output "FreedomEditorSetup-x64-$version.exe"
	$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
	[System.IO.File]::WriteAllText("$installer.sha256", "$hash  $([System.IO.Path]::GetFileName($installer))`n")
	Write-Output "Installer: $installer"
	Write-Output "SHA256: $hash"
} finally {
	$env:PATH = $environmentPath
	$env:ELECTRON_RUN_AS_NODE = $electronRunAsNode
	$env:SIGNTOOL_PATH = $previousSignToolPath
	Pop-Location
}