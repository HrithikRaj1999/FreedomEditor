# Windows Installation Guide

## Current Availability

**There is no published FreedomEditor setup EXE yet.** The public repository
currently provides source code and build scripts, not a ready-to-install Windows
application. The source ZIP is not an installer.

The instructions below are for building and running FreedomEditor from source.
If you only want a one-click installation, a validated installer must be built
and uploaded to [GitHub Releases](https://github.com/HrithikRaj1999/FreedomEditor/releases)
first. That installer is intended to bundle Electron and keep FreedomEditor
separate from official VS Code.

## Install the Build Tools

On the machine that will build FreedomEditor, open **PowerShell as Administrator**
and run:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget --accept-source-agreements --accept-package-agreements --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

**This installs Microsoft's C++ build tools and Windows SDK. It does not install
FreedomEditor or VS Code.** Let the installer finish before continuing. Installing
these system prerequisites needs your Windows administrator approval; do not
share your administrator password in chat.

## Prerequisites

- Windows x64, Git with Git LFS, Python, and Visual Studio 2022 Build Tools with the C++ desktop workload and Windows SDK.
- Node.js at least the version in `.nvmrc`, within the same major version, with npm below version 13.
- Substantial free disk space for source, native dependencies, Electron, and side-by-side builds.

These are contributor requirements, not requirements for installing a released
FreedomEditor setup EXE. Install privileged prerequisites yourself; build scripts
do not request elevation or collect passwords.

## Build and Launch

Get the source in PowerShell:

```powershell
git clone --branch freedomeditor-fixes --single-branch https://github.com/HrithikRaj1999/FreedomEditor.git
cd FreedomEditor
git lfs pull
```

Run in PowerShell from the repository root:

```powershell
npm ci
npm --prefix freedomeditor ci
node scripts/freedomeditor-brand.mjs
npm run compile-client
npm run electron
npm run download-builtin-extensions
.\scripts\freedomeditor.ps1 -Action init
.\scripts\freedomeditor.ps1 -Action extensions
.\scripts\freedomeditor.ps1 -Action launch
```

`init` creates ignored local configuration under `.freedomeditor/`. Defaults put
the runtime, profile, extensions, backups, and update state beneath that folder.
It does not overwrite an existing configuration. Optional `--profile` and
`--extensions` arguments can keep existing private folders in place. The optional
`--local-copilot` switch uses a compatible locally installed official VS Code
Copilot extension for local development only; it is not a redistribution step.

### Development identity, icons, and sign-in

`npm run electron` now patches the downloaded Windows executable's version
resources and icon with the build's existing `rcedit` dependency. After changing
the branding, close FreedomEditor and run:

```powershell
node scripts/freedomeditor-brand.mjs
node scripts/freedomeditor-electron.mjs
npm run compile-client
```

Renaming Electron alone does not change its Windows taskbar identity. The last
command also refreshes workbench assets in `out/`; source edits are not enough
for the development launcher. Fully quit and relaunch after rebuilding. If a
previous taskbar pin retains its old icon, unpin it and pin the relaunched app.

With no project arguments, launch passes `--new-window` to open a true empty
window instead of the FreedomEditor source repository. A `.code-workspace` file
can still be untrusted even when its `folders` array is empty, so the launcher
does not create one. Opening the source repository **untrusted**
disables built-in extensions located inside it, including GitHub Authentication,
causing missing features and Copilot authentication-provider timeouts even when
the encrypted session is saved. Copilot itself also remains disabled in
untrusted workspaces. Open your project through **File > Open Folder**,
or pass its path to the launcher. If developing FreedomEditor itself, review the
repository and make your own workspace-trust decision; the launcher does not
disable trust checks or automatically trust folders.

Launch and extension installation ignore inherited `VSCODE_PORTABLE`,
`VSCODE_APPDATA`, and `VSCODE_EXTENSIONS` overrides so the private configuration's
profile and extensions paths remain authoritative. Settings synchronization only
manages settings, keybindings, and snippets—not authentication databases or
Electron's `Local State`. Keep the configured profile and the product's
`sharedDataFolderName` directory: GitHub sessions use the latter's
`sharedStorage/state.vscdb`, encrypted through Electron's Windows DPAPI backend.
Do not rename these storage directories to fix branding or copy official
VS Code's credentials.

Official Copilot discovery supports both conventional and versioned VS Code
installations. An absent or incompatible extension is reported by the launcher;
Copilot licensing and enterprise policies still apply. Packaged installers need
a separate production build to include updated branding and compiled assets.

## Settings and Updates

Local Ctrl+mouse-wheel zoom is enabled by default through
`workbench.localMouseWheelZoom`. Point at a section or div to zoom that container
and its contents independently of neighboring sections, including Settings,
chat, and extension webviews. Code editors, virtualized lists, and terminals
zoom as complete widgets so their internal rows remain aligned. Normal wheel
scrolling is unchanged. Use **FreedomEditor: Reset Local Zoom** in the Command
Palette to restore all local zooms, or turn the setting off to disable the
feature and restore the original sizes. Zoom values are temporary and reset
when their UI is recreated. Restart all FreedomEditor windows after rebuilding
the feature, because webview resource handling also runs in the main process.

VS Code's default profile is the one-way settings source. For a named profile,
set `officialUserRoot` to its `User/profiles/<id>` directory in the private config.
Existing FreedomEditor differences are captured in `.freedomeditor/overrides/`.
Edit those overrides for persistent fork-specific settings, bindings, or snippets.
Future direct edits to synchronized files can be overwritten; backups are saved
under `.freedomeditor/backups/`. Disable `syncSettings` to manage profiles independently.

```powershell
.\scripts\freedomeditor.ps1 -Action status
.\scripts\freedomeditor.ps1 -Action check
.\scripts\freedomeditor.ps1 -Action update
.\scripts\freedomeditor.ps1 -Action schedule
.\scripts\freedomeditor.ps1 -Action rollback
```

Source launch checks for updates at most once per 24 hours. `schedule` optionally
registers a daily current-user Windows task. Updates require the build prerequisites
and may take time; they do not replace the running editor. Close every FreedomEditor
window and relaunch to activate a validated pending build. Rollback queues the
previous build and pauses automatic updates. Inspect `.freedomeditor/state.json`
and `.freedomeditor/update.log` if maintenance fails.

The original source tree remains the customization source of truth for staged
updates. Keep your changes there. Do not edit a generated release worktree.

## Windows Installer

Packaging requires the Windows SDK's `signtool.exe`. The build script accepts an
installed SDK, a SignTool already on `PATH`, or an explicit `-SignToolPath`.
Microsoft's signed
[Microsoft.Windows.SDK.BuildTools](https://www.nuget.org/packages/Microsoft.Windows.SDK.BuildTools)
NuGet package also contains SignTool and its companion files, without requiring
a system-wide SDK installation. Extract the complete package, not just the EXE.
No signing certificate is needed to build an **unsigned preview**; SignTool is
used to remove inherited signatures before changing Windows resources. This
does not sign FreedomEditor with Microsoft's identity.
The launcher applies a small, checked Git patch to `@vscode/gulp-electron`
before packaging because version 1.43.1 otherwise ignores `PATH` and only
searches the system SDK directory. The patch adds explicit `SIGNTOOL_PATH`
support without changing signature removal or branding. An incompatible
dependency update fails visibly instead of silently skipping the patch.
Windows resource patching recognizes bundled ELF and Mach-O payloads and leaves
them untouched; it still fails on missing or unrecognized native files. The
`vscode-win32-x64-min-patch-dependencies` gulp task can resume this final step
after the application and Copilot runtime have already been packaged.

```powershell
.\scripts\freedomeditor-build.ps1

# Reuse installed dependencies and an extracted Microsoft SDK:
.\scripts\freedomeditor-build.ps1 -SkipDependencies -SignToolPath 'C:\FreedomEditorToolchain\windows-sdk-buildtools-10.0.28000.2705\bin\10.0.28000.0\x64\signtool.exe'
```

The build uses VS Code's production pipeline, then Inno Setup to make a per-user
installer. Output and SHA-256 files go to `.freedomeditor/artifacts/`. Electron is
bundled. `-SkipDependencies` reuses both the repository and maintenance
dependencies; `-SkipCompile` only packages an already complete production build.
The script rejects missing runtime files, unbranded executables, and missing
compiled FreedomEditor, GitHub Authentication, or Copilot entry points. Neither
option creates missing build output. The application staging directory is `..\VSCode-win32-x64` as
required by the upstream build; final release artifacts remain inside this repo.
Debug source maps remain in the build tree but are omitted from the installer.
The installer checks the chosen destination against Windows' legacy path limit
before copying files, instead of failing halfway through deeply nested Copilot
dependencies. It does not change the machine's long-path policy.

The per-user installer creates native FreedomEditor shortcuts and registers
`freedomeditor://` authentication callbacks. It does not copy an official VS Code
installation into the package. Optional coding tools install through Open VSX.
Python, Debugpy, and Python Environments receive their explicitly declared
proposed APIs in the product configuration, rather than enabling proposed APIs
globally or depending on development-mode privileges. Open VSX distributions
can still differ from Microsoft's packages, including native helper availability.

### Keep an existing source-launch profile

Normal installed launches use `%APPDATA%\FreedomEditor` for the profile and
`%USERPROFILE%\.freedom-editor\extensions` for extensions. To reuse separate
existing FreedomEditor directories without copying authentication databases,
close the editor and create NTFS junctions **only if these default locations do
not already exist**:

```powershell
New-Item -ItemType Junction -Path "$env:APPDATA\FreedomEditor" -Target 'C:\FreedomEditorProfile'
New-Item -ItemType Directory -Path "$env:USERPROFILE\.freedom-editor" -Force
New-Item -ItemType Junction -Path "$env:USERPROFILE\.freedom-editor\extensions" -Target 'C:\FreedomEditorExtensions'
```

Do not delete or replace an existing profile to make these commands succeed.
Keep `%USERPROFILE%\.freedom-editor-shared` unchanged; it contains the shared,
encrypted GitHub sessions. These junctions let the EXE, shortcuts, CLI, and
authentication callbacks all use the same profile, including after updates.
The installer and uninstaller do not remove these external data directories.
Do not run source and installed instances against this same profile at the same time.

Before publishing, test on a clean Windows machine: installation and uninstall,
normal startup, Python and TypeScript activation, terminals, PDF and Mermaid
previews, themes, and updates. Do not label a source build as a tested installer.
Sign release binaries when a trusted signing identity is available.

## Focused Checks

```powershell
npm --prefix freedomeditor test
```

Theme tests check core contrast pairs and native command routing. Sync tests
cover JSONC, backups, overrides, stable-release decisions, and activation guards.
They do not replace full editor integration tests or clean-machine installer tests.

After compiling the client, run `scripts\test.bat --run
vs/base/test/browser/elementZoom.test --grep "Local Element Zoom" --fail-zero`
for the local zoom unit tests. Run `node scripts/freedomeditor-smoke.mjs
--local-zoom` for an isolated desktop check of Settings and secure webviews,
local text-size isolation, reset, disabling, and wide/compact layouts. This
mode uses the existing webview service without requiring extension activation.
Screenshots are stored under `.freedomeditor/smoke/`.

The optional `node scripts/freedomeditor-smoke.mjs` uses isolated profile and
shared-storage directories to exercise the real Electron UI and record
screenshots under `.freedomeditor\smoke\`, without changing published previews
or personal authentication storage. To exercise a packaged build instead of the
development runtime:

```powershell
node scripts\freedomeditor-smoke.mjs --executable 'C:\VSCode-win32-x64\FreedomEditor.exe'
```

This checks customization commands, both Freedom themes, and compact layouts.
It disables Copilot in its isolated fixture and does not prove live Copilot
service access. The internal `--local-zoom` webview fixture requires an unbundled
development build and cannot be combined with `--executable`.

## Publishing

Publish source and explicit release artifacts only. Never upload profiles,
tokens, logs, `.freedomeditor/`, `node_modules/`, `.build/`, or an installed
Microsoft VS Code directory. Review `git diff --cached` before committing.
Retain upstream and third-party licenses; do not claim Microsoft/Google
affiliation or universal extension compatibility.
Source-only publishing is separate from redistributing the installer. Review
the bundled Copilot CLI and other dependency licenses before publishing binary
releases; the repository's MIT license does not override their redistribution
conditions.