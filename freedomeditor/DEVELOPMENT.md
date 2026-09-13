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
git clone --branch freedomeditor --single-branch https://github.com/HrithikRaj1999/FreedomEditor.git
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

With no project arguments, launch opens an explicit empty workspace instead of
the FreedomEditor source repository. Opening the source repository **untrusted**
disables built-in extensions located inside it, including GitHub Authentication,
causing missing features and Copilot authentication-provider timeouts even when
the encrypted session is saved. Open your project through **File > Open Folder**,
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

Current local release blocker: the production JavaScript and extension bundles
compiled, but packaging could not find the Windows SDK's `signtool.exe`. Install
the Windows 10 or 11 SDK through Visual Studio 2022 Build Tools, with the Desktop
development with C++ workload. This machine prerequisite requires your own
installer permissions; no signing certificate is needed for an unsigned preview.
The build script now checks for the SDK before starting compilation.

```powershell
.\scripts\freedomeditor-build.ps1
```

The build uses VS Code's production pipeline, then Inno Setup to make a per-user
installer. Output and SHA-256 files go to `.freedomeditor/artifacts/`. Electron is
bundled. `-SkipDependencies` reuses installed dependencies; `-SkipCompile` only
packages an already complete production build. Neither option creates missing
build output. The application staging directory is `../VSCode-win32-x64` as
required by the upstream build; final release artifacts remain inside this repo.

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

The optional `node scripts/freedomeditor-smoke.mjs` uses an isolated profile to
exercise the real Electron UI and record screenshots. It has not passed end to
end yet: theme-picker selection and extension-host startup timed out in local
validation. Do not treat the captured Graphite preview as a successful full
GUI or extension-activation test. Light-theme and compact-window checks remain
unverified in the real UI.

## Publishing

Publish source and explicit release artifacts only. Never upload profiles,
tokens, logs, `.freedomeditor/`, `node_modules/`, `.build/`, or an installed
Microsoft VS Code directory. Review `git diff --cached` before committing.
Retain upstream and third-party licenses; do not claim Microsoft/Google
affiliation or universal extension compatibility.