# Windows Development

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

## Settings and Updates

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