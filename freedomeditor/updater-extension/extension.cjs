/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vscode = require('vscode');
const protocol = require('./protocol.cjs');

function activate(context) {
	if (process.platform !== 'win32') {
		return;
	}
	const configPath = protocol.configurationPath();
	const paths = protocol.updatePaths(configPath);
	const output = vscode.window.createOutputChannel('FreedomEditor Updates');
	context.subscriptions.push(output);
	let lastPhase;
	let disposed = false;
	let refreshTimer;
	let wasEnabled = false;
	const reportError = error => {
		if (disposed) {
			return;
		}
		output.appendLine(error.message);
		void vscode.window.showWarningMessage(vscode.l10n.t('FreedomEditor automatic updates need attention. See the update log for details.'));
	};
	const showLog = async () => {
		output.show(true);
		if (fs.existsSync(paths.log)) {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(paths.log));
			await vscode.window.showTextDocument(document, { preview: true });
		}
	};
	const readConfiguration = () => {
		if (!fs.existsSync(configPath)) {
			return undefined;
		}
		return protocol.validateConfiguration(JSON.parse(fs.readFileSync(configPath, 'utf8')));
	};
	const startWorker = action => {
		try {
			const config = readConfiguration();
			if (!config) {
				output.appendLine(vscode.l10n.t('Automatic updates are not configured on this machine.'));
				if (action !== 'update') {
					void vscode.window.showInformationMessage(vscode.l10n.t('Configure FreedomEditor updates with scripts\\freedomeditor-auto-update.ps1 before checking for updates.'));
				}
				return;
			}
			if (action === 'update' && !config.enabled) {
				return;
			}
			// A workspace setting cannot redirect this machine-level updater to another checkout or executable.
			const actualInstall = path.resolve(vscode.env.appRoot, '..', '..');
			if (actualInstall.toLowerCase() !== path.resolve(config.installRoot).toLowerCase()) {
				output.appendLine(vscode.l10n.t('This window is not the configured installed FreedomEditor; no automatic update was started.'));
				return;
			}
			const invocation = protocol.workerInvocation(config, action, configPath);
			const log = fs.openSync(paths.log, 'a');
			try {
				const child = spawn(invocation.executable, invocation.args, {
					cwd: invocation.cwd, env: protocol.workerEnvironment(), detached: true,
					windowsHide: true, stdio: ['ignore', log, log]
				});
				child.once('error', reportError);
				child.once('exit', code => {
					if (code && !disposed) {
						reportError(new Error(vscode.l10n.t('The FreedomEditor update worker stopped with exit code {0}.', code)));
					}
				});
				child.unref();
			} finally {
				fs.closeSync(log);
			}
		} catch (error) {
			reportError(error);
		}
	};
	const refresh = async () => {
		if (disposed) {
			return;
		}
		try {
			const config = readConfiguration();
			if (config?.enabled && !wasEnabled) {
				startWorker('update');
			}
			wasEnabled = config?.enabled === true;
			if (!fs.existsSync(paths.state)) {
				return;
			}
			const state = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
			const phase = `${state.phase}:${state.pending?.version ?? state.current?.version}:${state.lastError ?? ''}`;
			if (phase === lastPhase) {
				return;
			}
			lastPhase = phase;
			output.appendLine(`${state.updatedAt ?? ''} ${state.phase}: ${state.latestVersion ?? state.current?.version ?? ''}`);
			if (state.phase === 'waiting-for-close') {
				void vscode.window.showInformationMessage(vscode.l10n.t('FreedomEditor {0} is ready. It will install after you close all FreedomEditor windows; your profile will be kept.', state.pending.version));
			} else if (state.phase === 'error') {
				if (state.lastError) {
					output.appendLine(state.lastError);
				}
				const key = `update-error:${state.lastError}`;
				if (context.globalState.get('lastUpdateNotice') !== key) {
					await context.globalState.update('lastUpdateNotice', key);
					reportError(new Error(vscode.l10n.t('Automatic updates could not finish. The update log includes the recovery package and any required action.')));
				}
			} else if (state.phase === 'installed') {
				const key = `installed:${state.current.upstreamCommit}`;
				if (context.globalState.get('lastUpdateNotice') !== key) {
					await context.globalState.update('lastUpdateNotice', key);
					void vscode.window.showInformationMessage(vscode.l10n.t('FreedomEditor was updated to VS Code {0}, keeping your customizations and profile.', state.current.version));
				}
			} else if (state.phase === 'available') {
				void vscode.window.showInformationMessage(vscode.l10n.t('VS Code {0} is available. Enabled automatic updates will build the FreedomEditor-patched version in the background.', state.latestVersion));
			}
		} catch (error) {
			reportError(error);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('freedomeditor.checkForUpdates', () => startWorker('check')),
		vscode.commands.registerCommand('freedomeditor.showUpdateLog', showLog),
		vscode.commands.registerCommand('freedomeditor.pauseUpdates', () => startWorker('pause')),
		vscode.commands.registerCommand('freedomeditor.resumeUpdates', () => startWorker('resume')),
		{ dispose() { disposed = true; clearTimeout(refreshTimer); } }
	);
	try {
		fs.mkdirSync(paths.directory, { recursive: true });
		const watcher = fs.watch(paths.directory, (_event, filename) => {
			if (!filename || ['config.json', 'state.json'].includes(filename.toString())) {
				clearTimeout(refreshTimer);
				refreshTimer = setTimeout(() => { void refresh(); }, 100);
			}
		});
		watcher.on('error', reportError);
		context.subscriptions.push({ dispose: () => watcher.close() });
		void refresh();
	} catch (error) {
		reportError(error);
	}
}

module.exports = { activate };
