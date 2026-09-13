[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string]$ConfigPath,
	[Parameter(Mandatory = $true)]
	[string]$InstallerPath,
	[Parameter(Mandatory = $true)]
	[ValidatePattern('^[a-fA-F0-9]{64}$')]
	[string]$ExpectedHash,
	[switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

public static class FreedomEditorUpdateSession {
	private static int ending;
	private static string flag;
	[DllImport("user32.dll")]
	private static extern int GetSystemMetrics(int index);
	[DllImport("kernel32.dll", SetLastError = true)]
	private static extern IntPtr OpenProcess(int access, bool inherit, int processId);
	[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
	[DllImport("kernel32.dll")]
	private static extern bool CloseHandle(IntPtr handle);
	public static string ExecutablePath(int processId) {
		IntPtr process = OpenProcess(0x1000, false, processId);
		if (process == IntPtr.Zero) {
			int error = Marshal.GetLastWin32Error();
			if (error == 87) { return null; }
			throw new Win32Exception(error);
		}
		try {
			int size = 32768;
			StringBuilder name = new StringBuilder(size);
			if (!QueryFullProcessImageName(process, 0, name, ref size)) {
				throw new Win32Exception(Marshal.GetLastWin32Error());
			}
			return name.ToString();
		} finally { CloseHandle(process); }
	}
	public static void Watch(string file) {
		flag = file;
		SystemEvents.SessionEnding += delegate(object sender, SessionEndingEventArgs args) { MarkEnding(); };
		SystemEvents.SessionEnded += delegate(object sender, SessionEndedEventArgs args) { MarkEnding(); };
	}
	private static void MarkEnding() {
		Interlocked.Exchange(ref ending, 1);
		try { File.WriteAllText(flag, "session ending"); }
		catch (IOException error) { Console.Error.WriteLine(error.Message); }
		catch (UnauthorizedAccessException error) { Console.Error.WriteLine(error.Message); }
	}
	public static bool IsEnding() {
		return Interlocked.CompareExchange(ref ending, 0, 0) != 0 || GetSystemMetrics(0x2000) != 0;
	}
}
'@

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$directory = Split-Path -Parent $ConfigPath
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.schemaVersion -ne 1 -or $config.channel -ne 'stable' -or -not [System.IO.Path]::IsPathRooted($config.installRoot)) {
	throw 'Invalid native update configuration.'
}
$installRoot = [System.IO.Path]::GetFullPath($config.installRoot).TrimEnd('\')
$executable = Join-Path $installRoot 'FreedomEditor.exe'
$manifestPath = Join-Path $installRoot 'resources\app\package.json'
$productPath = Join-Path $installRoot 'resources\app\product.json'
$hasher = [System.Security.Cryptography.SHA256]::Create()
try {
	$gateHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($installRoot.ToLowerInvariant()))).Replace('-', '').ToLowerInvariant().Substring(0, 32)
} finally {
	$hasher.Dispose()
}
if ($config.gateMutexName -cne "Global\FreedomEditorUpdate-$gateHash") {
	throw 'The update gate does not match this installation.'
}
$sessionFlag = Join-Path $directory "session-$PID-$([Guid]::NewGuid().ToString('N')).ending"
[FreedomEditorUpdateSession]::Watch($sessionFlag)
$gate = $null
$ownsGate = $false

function Get-EditorState {
	$unknown = $false
	foreach ($process in [Diagnostics.Process]::GetProcessesByName('FreedomEditor')) {
		try {
			$image = [FreedomEditorUpdateSession]::ExecutablePath($process.Id)
			if ($image -and [System.IO.Path]::GetFullPath($image) -ieq $executable) {
				return 'running'
			}
		} catch [System.ComponentModel.Win32Exception] {
			$unknown = $true
			[Console]::Error.WriteLine("Cannot identify FreedomEditor process $($process.Id): $($_.Exception.Message)")
		} finally {
			$process.Dispose()
		}
	}
	if ($unknown) { return 'unknown' }
	return 'closed'
}

function Test-Enabled {
	$latest = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
	if ($latest.installRoot -cne $config.installRoot -or $latest.gateMutexName -cne $config.gateMutexName) {
		throw 'The configured installation changed while an update was waiting.'
	}
	return $latest.enabled -eq $true
}

function Assert-Baseline {
	$state = Get-Content -LiteralPath (Join-Path $directory 'state.json') -Raw | ConvertFrom-Json
	$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
	$product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json
	if ($manifest.main -ne './freedomeditor/updater-bootstrap.mjs' -or $manifest.freedomEditorUpdateBootstrap -ne 1) {
		throw 'This installation does not have the native update launch gate. Reconfigure updates before applying a package.'
	}
	if ($manifest.version -ne $state.current.version -or
		($product.freedomEditorUpdate.upstreamCommit -and $product.freedomEditorUpdate.upstreamCommit -ne $state.current.upstreamCommit) -or
		(Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ine $state.current.executableSha256) {
		throw 'The installed baseline changed while the update was being prepared. Nothing was installed.'
	}
	foreach ($property in $config.identity.PSObject.Properties) {
		if ($product.($property.Name) -cne $property.Value) {
			throw "The installed $($property.Name) no longer matches the configured identity."
		}
	}
	if ($state.pending.installer -ine $InstallerPath -or $state.pending.sha256 -ine $ExpectedHash) {
		throw 'The installer does not match the recorded pending update.'
	}
}

try {
	Write-Output 'Waiting for all processes from the installed FreedomEditor to close; no process will be terminated.'
	while ($true) {
		if (-not (Test-Enabled)) { Write-Output 'Automatic updates were paused.'; exit 10 }
		if ([FreedomEditorUpdateSession]::IsEnding()) { Write-Output 'Windows session ending; installation deferred.'; exit 11 }
		$editorState = Get-EditorState
		if ($editorState -eq 'unknown') { Write-Output 'A FreedomEditor process could not be identified safely; installation deferred.'; exit 11 }
		if ($editorState -eq 'closed') { break }
		if ($CheckOnly) { Write-Output 'FreedomEditor is still running; installation deferred.'; exit 11 }
		Start-Sleep -Seconds 2
	}
	$created = $false
	$gate = New-Object System.Threading.Mutex($true, $config.gateMutexName, [ref]$created)
	if (-not $created) { Write-Output 'Another installer owns the launch gate; installation deferred.'; exit 11 }
	$ownsGate = $true

	# Any launch which passed the gate before it was acquired must also drain naturally.
	while ($true) {
		$editorState = Get-EditorState
		if ($editorState -eq 'closed') { break }
		if ($editorState -eq 'unknown') { Write-Output 'A process could not be identified safely; installation deferred.'; exit 11 }
		if ($CheckOnly -or [FreedomEditorUpdateSession]::IsEnding()) { Write-Output 'A startup or session transition is in progress; installation deferred.'; exit 11 }
		if (-not (Test-Enabled)) { Write-Output 'Automatic updates were paused.'; exit 10 }
		Start-Sleep -Seconds 2
	}
	Assert-Baseline
	if ((Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash -ine $ExpectedHash) {
		throw 'The installer checksum changed. Nothing was installed.'
	}
	if (-not (Test-Enabled)) { Write-Output 'Automatic updates were paused.'; exit 10 }
	if ([FreedomEditorUpdateSession]::IsEnding()) { Write-Output 'Windows session ending; installation deferred.'; exit 11 }
	if ($CheckOnly) { Write-Output 'The guarded installation preflight completed without running the installer.'; exit 0 }

	$arguments = @(
		'/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS',
		"/DIR=`"$installRoot`"", '/MERGETASKS="!codingextensions"', "/sessionend=`"$sessionFlag`"",
		"/LOG=`"$(Join-Path $directory 'installer.log')`""
	)
	Write-Output 'Installing the validated FreedomEditor package with the launch gate held.'
	$installer = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -PassThru -Wait
	if ($installer.ExitCode -ne 0) { throw "Inno Setup failed with exit code $($installer.ExitCode). See installer.log; recovery data is retained." }
	$state = Get-Content -LiteralPath (Join-Path $directory 'state.json') -Raw | ConvertFrom-Json
	$receipt = @{
		schemaVersion = 1; sha256 = $ExpectedHash.ToLowerInvariant()
		version = $state.pending.version; upstreamCommit = $state.pending.upstreamCommit
		completedAt = [DateTime]::UtcNow.ToString('o')
	} | ConvertTo-Json
	$receiptPath = Join-Path $directory 'installation.json'
	$temporary = "$receiptPath.$PID.tmp"
	$stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
	try {
		$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($receipt)
		$stream.Write($bytes, 0, $bytes.Length)
		$stream.Flush($true)
	} finally {
		$stream.Dispose()
	}
	Move-Item -LiteralPath $temporary -Destination $receiptPath -Force
} finally {
	if ($ownsGate) { $gate.ReleaseMutex() }
	if ($gate) { $gate.Dispose() }
	if (Test-Path -LiteralPath $sessionFlag) { Remove-Item -LiteralPath $sessionFlag -Force }
}
