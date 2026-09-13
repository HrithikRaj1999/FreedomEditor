# FreedomEditor Updates

Machine-local startup integration for FreedomEditor's official stable VS Code
source updater. It keeps FreedomEditor's branding and committed customizations,
builds separately, and waits for the installed editor to close before applying.
It never downloads Microsoft's VS Code distribution as a replacement editor.

This companion does nothing until the local source updater is configured.
Configuration lives in `%LOCALAPPDATA%\FreedomEditor\updates`, not in workspace
settings or Settings Sync. Only the configured installed FreedomEditor can start
the worker. The UI extension can run in untrusted workspaces because it does not
use workspace paths, executables, or settings to configure updates.

Available commands:

- **FreedomEditor: Check for Updates**
- **FreedomEditor: Show Update Log**
- **FreedomEditor: Pause Automatic Updates**
- **FreedomEditor: Resume Automatic Updates**

Installation and recovery instructions are in the repository's
[Windows development guide](https://github.com/HrithikRaj1999/FreedomEditor/blob/freedomeditor-fixes/freedomeditor/DEVELOPMENT.md#native-automatic-source-updates).
The source checkout, Node.js, Windows build prerequisites, and SDK must remain
available. First sign-in, account changes, revocation, and enterprise policy may
still require authentication; the updater does not change saved credentials.
