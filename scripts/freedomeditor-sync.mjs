import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const defaultDataRoot = path.join(sourceRoot, '.freedomeditor');
const require = createRequire(path.join(sourceRoot, 'freedomeditor/package.json'));
const jsonc = require('jsonc-parser');
const semver = require('semver');

const updateEndpoint = 'https://update.code.visualstudio.com/api/update/win32-x64-user/stable/latest';
const upstreamUrl = 'https://github.com/microsoft/vscode.git';

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { cwd: sourceRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
	if (result.error || result.status !== 0) {
		throw new Error(`${path.basename(command)} ${args[0] ?? ''} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
	}
	return result.stdout?.trim() ?? '';
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, value) {
	writeAtomic(filePath, `${JSON.stringify(value, null, '\t')}\n`);
}

function configuration() {
	const config = readJson(path.join(defaultDataRoot, 'config.json'));
	return { ...config, sourceRoot, dataRoot: defaultDataRoot };
}

function editorRunning() {
	if (process.platform !== 'win32') {
		throw new Error('The automatic launcher currently supports Windows only.');
	}
	return /"FreedomEditor\.exe"/i.test(run('tasklist.exe', ['/FI', 'IMAGENAME eq FreedomEditor.exe', '/FO', 'CSV', '/NH']));
}

function acquireLock(dataRoot) {
	mkdirSync(dataRoot, { recursive: true });
	const lockPath = path.join(dataRoot, 'maintenance.lock');
	if (existsSync(lockPath)) {
		const owner = readJson(lockPath);
		try {
			process.kill(owner.pid, 0);
			return undefined;
		} catch (error) {
			if (error.code !== 'ESRCH') {
				return undefined;
			}
			rmSync(lockPath);
		}
	}
	try {
		writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
		return () => rmSync(lockPath, { force: true });
	} catch (error) {
		if (error.code === 'EEXIST') {
			return undefined;
		}
		throw error;
	}
}

export function releaseDecision(current, latest) {
	compareVersions(current.version, latest.productVersion);
	if (!/^[a-f0-9]{40}$/i.test(latest.version)) {
		throw new Error('Official update service returned an invalid source commit.');
	}
	const comparison = compareVersions(latest.productVersion, current.version);
	if (comparison === 0 && current.upstreamCommit !== latest.version) {
		throw new Error('The stable version matches but its upstream commit differs; manual review is required.');
	}
	return comparison > 0 ? 'update' : comparison < 0 ? 'ahead' : 'current';
}

export function selectRelease(state, running) {
	if (running || !state.pending) {
		return state;
	}
	return { ...state, active: state.pending, previous: state.active, pending: null };
}

function validateRelease(release) {
	const manifest = readJson(path.join(release.path, 'package.json'));
	if (manifest.version !== release.version || !existsSync(path.join(release.path, 'out/main.js')) || !existsSync(path.join(release.path, '.build/electron/FreedomEditor.exe'))) {
		throw new Error(`Release is incomplete: ${release.path}`);
	}
}

async function latestRelease() {
	const response = await fetch(updateEndpoint, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) {
		throw new Error(`Official update check failed: HTTP ${response.status}`);
	}
	return response.json();
}

function initialConfiguration(args) {
	const option = name => {
		const index = args.indexOf(name);
		return index >= 0 ? args[index + 1] : undefined;
	};
	const configPath = path.join(defaultDataRoot, 'config.json');
	if (existsSync(configPath)) {
		throw new Error('Already initialized. Edit the private .freedomeditor/config.json to change local paths.');
	}
	const upstreamBase = run('git', ['describe', '--tags', '--match', '[0-9]*', '--abbrev=0']);
	compareVersions(upstreamBase, upstreamBase);
	const upstreamCommit = run('git', ['rev-parse', `${upstreamBase}^{commit}`]);
	const nodeRoot = path.join(defaultDataRoot, 'toolchain', `node-${process.versions.node}`);
	for (const relative of ['node.exe', 'npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1', 'node_modules/npm', 'LICENSE']) {
		const original = path.join(path.dirname(process.execPath), relative);
		const destination = path.join(nodeRoot, relative);
		if (existsSync(original) && !existsSync(destination)) {
			mkdirSync(path.dirname(destination), { recursive: true });
			cpSync(original, destination, { recursive: true });
		}
	}
	const config = {
		sourceRoot,
		dataRoot: defaultDataRoot,
		profileRoot: path.resolve(option('--profile') ?? path.join(defaultDataRoot, 'profile')),
		extensionsRoot: path.resolve(option('--extensions') ?? path.join(defaultDataRoot, 'extensions')),
		officialUserRoot: path.resolve(option('--official-user') ?? path.join(process.env.APPDATA, 'Code/User')),
		officialInstallRoot: path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code'),
		useOfficialCopilot: args.includes('--local-copilot'),
		syncSettings: true,
		autoUpdate: true,
		checkIntervalHours: 24,
		upstreamBase: upstreamCommit,
		nodePath: path.join(nodeRoot, 'node.exe')
	};
	const active = { path: sourceRoot, version: readJson(path.join(sourceRoot, 'package.json')).version, upstreamCommit };
	validateRelease(active);
	if (existsSync(config.officialUserRoot)) {
		initializeProfileOverrides(config);
	}
	saveJson(configPath, config);
	saveJson(path.join(defaultDataRoot, 'state.json'), { active, previous: null, pending: null });
	console.log('Initialized private update state. The running editor and profile were not changed.');
}

function overlayNewFiles(config, destination) {
	const names = run('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
	const allowed = /^(freedomeditor\/|extensions\/freedomeditor\/|scripts\/freedomeditor[\w.-]*$|\.github\/workflows\/freedomeditor[\w.-]*$|FREEDOMEDITOR\.md$)/;
	for (const relative of names) {
		if (!allowed.test(relative)) {
			throw new Error(`Untracked file requires review before updating: ${relative}`);
		}
		const target = path.join(destination, relative);
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(path.join(config.sourceRoot, relative), target);
	}
}

function buildRelease(config, stagedRoot) {
	const requiredNode = readFileSync(path.join(stagedRoot, '.nvmrc'), 'utf8').trim();
	const nodeVersion = run(config.nodePath, ['--version']).replace(/^v/, '');
	if (!semver.satisfies(nodeVersion, `>=${requiredNode} <${semver.major(requiredNode) + 1}.0.0`)) {
		throw new Error(`The new release needs Node ${requiredNode} (same major). Update the private nodePath and retry; your working editor is unchanged.`);
	}
	const npm = path.join(path.dirname(config.nodePath), 'node_modules/npm/bin/npm-cli.js');
	const environment = { ...process.env, PATH: `${path.dirname(config.nodePath)}${path.delimiter}${process.env.PATH ?? ''}`, VSCODE_SKIP_PRELAUNCH: '1', NODE_OPTIONS: '--max-old-space-size=8192' };
	delete environment.ELECTRON_RUN_AS_NODE;
	for (const args of [['ci'], ['run', 'compile-client'], ['run', 'electron'], ['run', 'download-builtin-extensions']]) {
		run(config.nodePath, [npm, ...args], { cwd: stagedRoot, env: environment, stdio: 'inherit', timeout: 90 * 60_000 });
	}
	run(path.join(stagedRoot, '.build/electron/FreedomEditor.exe'), [
		path.join(stagedRoot, 'test/unit/electron/index.js'),
		'--run', 'vs/workbench/contrib/chat/test/common/constants.test', '--grep', 'FreedomEditor', '--fail-zero'
	], { cwd: stagedRoot, env: environment, stdio: 'inherit', timeout: 180_000 });
}

async function update(config, automatic) {
	const unlock = acquireLock(config.dataRoot);
	if (!unlock) {
		console.log('Maintenance is already running.');
		return;
	}
	const statePath = path.join(config.dataRoot, 'state.json');
	const state = readJson(statePath);
	try {
		if (automatic && (!config.autoUpdate || Date.now() - Date.parse(state.lastAttempt ?? '1970-01-01') < config.checkIntervalHours * 3_600_000)) {
			return;
		}
		state.lastAttempt = new Date().toISOString();
		saveJson(statePath, state);
		const latest = await latestRelease();
		state.latest = latest.productVersion;
		state.lastError = null;
		if (releaseDecision(state.active, latest) !== 'update' || state.pending?.upstreamCommit === latest.version) {
			saveJson(statePath, state);
			console.log(`FreedomEditor ${state.active.version}; latest official stable ${latest.productVersion}.`);
			return;
		}
		run('git', ['fetch', '--no-tags', upstreamUrl, `refs/tags/${latest.productVersion}`], { timeout: 5 * 60_000 });
		const fetched = run('git', ['rev-parse', 'FETCH_HEAD^{commit}']);
		if (fetched !== latest.version) {
			throw new Error('The GitHub stable tag does not match the official update service commit.');
		}
		const stagedRoot = path.join(config.dataRoot, 'releases', `${latest.productVersion}-${Date.now()}`);
		mkdirSync(path.dirname(stagedRoot), { recursive: true });
		run('git', ['worktree', 'add', '--detach', stagedRoot, fetched], { timeout: 180_000 });
		state.staging = stagedRoot;
		saveJson(statePath, state);
		const patch = run('git', ['diff', '--binary', config.upstreamBase, '--']);
		if (patch) {
			const patchPath = path.join(config.dataRoot, `customizations-${Date.now()}.patch`);
			writeFileSync(patchPath, `${patch}\n`);
			run('git', ['-C', stagedRoot, 'apply', '--3way', '--index', patchPath]);
		}
		overlayNewFiles(config, stagedRoot);
		buildRelease(config, stagedRoot);
		const pending = { path: stagedRoot, version: latest.productVersion, upstreamCommit: fetched };
		validateRelease(pending);
		state.pending = pending;
		state.staging = null;
		saveJson(statePath, state);
		console.log(`FreedomEditor ${pending.version} is ready for the next full restart.`);
	} catch (error) {
		state.lastError = error.message;
		saveJson(statePath, state);
		throw error;
	} finally {
		unlock();
	}
}

function extensionCli(config, release, args) {
	return run(path.join(release.path, '.build/electron/FreedomEditor.exe'), [
		path.join(release.path, 'out/cli.js'), release.path,
		'--user-data-dir', config.profileRoot, '--extensions-dir', config.extensionsRoot, ...args
	], { cwd: release.path, env: { ...launchEnvironment(), ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 15 * 60_000 });
}

export function launchEnvironment(parent = process.env) {
	const environment = { ...parent, NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1' };
	// These inherited overrides take precedence over the configured profile/extension paths.
	for (const key of Object.keys(environment)) {
		if (['ELECTRON_RUN_AS_NODE', 'VSCODE_PORTABLE', 'VSCODE_APPDATA', 'VSCODE_EXTENSIONS'].includes(key.toUpperCase())) {
			delete environment[key];
		}
	}
	return environment;
}

export function launchWorkspaceArguments(config, args) {
	if (args.length) {
		return args;
	}
	// Opening the source tree untrusted disables the built-ins located inside it.
	// An explicit empty workspace also prevents extension-development window restoration.
	const workspace = path.join(config.dataRoot, 'launch.code-workspace');
	if (!existsSync(workspace)) {
		mkdirSync(config.dataRoot, { recursive: true });
		saveJson(workspace, { folders: [] });
	}
	return [workspace];
}

function scheduleCheck(config) {
	if (!config.autoUpdate) {
		return;
	}
	mkdirSync(config.dataRoot, { recursive: true });
	const log = openSync(path.join(config.dataRoot, 'update.log'), 'a');
	try {
		const environment = { ...process.env };
		delete environment.ELECTRON_RUN_AS_NODE;
		const child = spawn(config.nodePath, [path.join(sourceRoot, 'scripts/freedomeditor-sync.mjs'), 'update', '--auto'], {
			cwd: sourceRoot, env: environment, detached: true, windowsHide: true, stdio: ['ignore', log, log]
		});
		child.on('error', error => console.error(`Update check could not start: ${error.message}`));
		child.unref();
	} finally {
		closeSync(log);
	}
}

function launch(config, args) {
	const statePath = path.join(config.dataRoot, 'state.json');
	let state = readJson(statePath);
	const running = editorRunning();
	const unlock = acquireLock(config.dataRoot);
	if (unlock) {
		try {
			if (state.pending && !running) {
				validateRelease(state.pending);
				state = selectRelease(state, false);
				saveJson(statePath, state);
			}
			if (config.syncSettings && !running && existsSync(config.officialUserRoot)) {
				try {
					syncProfile(config);
				} catch (error) {
					console.error(`Settings sync skipped: ${error.message}`);
				}
			}
		} finally {
			unlock();
		}
	}
	validateRelease(state.active);
	const launchArgs = [state.active.path, '--user-data-dir', config.profileRoot, '--extensions-dir', config.extensionsRoot, '--disable-extension=vscode.vscode-api-tests'];
	if (config.useOfficialCopilot) {
		try {
			const installation = findOfficialCodeApp(config.officialInstallRoot);
			const copilotPath = path.join(installation.appPath, 'extensions/copilot');
			const copilot = readJson(path.join(copilotPath, 'package.json'));
			if (!semver.satisfies(state.active.version, copilot.engines.vscode)) {
				throw new Error(`Copilot requires VS Code ${copilot.engines.vscode}; active editor is ${state.active.version}.`);
			}
			launchArgs.push(`--extensionDevelopmentPath=${copilotPath}`);
		} catch (error) {
			console.error(`Optional local Copilot was not loaded: ${error.message}`);
		}
	}
	launchArgs.push(...launchWorkspaceArguments(config, args));
	const environment = launchEnvironment();
	const child = spawn(path.join(state.active.path, '.build/electron/FreedomEditor.exe'), launchArgs, {
		cwd: state.active.path, env: environment, detached: true, windowsHide: false, stdio: 'ignore'
	});
	child.on('error', error => { console.error(error.message); process.exitCode = 1; });
	child.unref();
	scheduleCheck(config);
}

async function main() {
	const [command = 'status', ...args] = process.argv.slice(2);
	if (command === 'init') {
		initialConfiguration(args);
		return;
	}
	const config = configuration();
	const statePath = path.join(config.dataRoot, 'state.json');
	const state = readJson(statePath);
	switch (command) {
		case 'status':
			console.log(JSON.stringify(state, null, 2));
			break;
		case 'check': {
			const latest = await latestRelease();
			console.log(JSON.stringify({ installed: state.active.version, latest: latest.productVersion, status: releaseDecision(state.active, latest) }, null, 2));
			break;
		}
		case 'update':
			await update(config, args.includes('--auto'));
			break;
		case 'sync':
			if (editorRunning()) {
				throw new Error('Close FreedomEditor before synchronizing its profile.');
			}
			console.log(JSON.stringify(syncProfile(config), null, 2));
			break;
		case 'launch':
			launch(config, args);
			break;
		case 'extensions':
			extensionCli(config, state.active, readJson(path.join(sourceRoot, 'freedomeditor/extensions.json')).flatMap(id => ['--install-extension', id]));
			break;
		case 'rollback': {
			if (!state.previous) {
				throw new Error('No previous release is available.');
			}
			const unlock = acquireLock(config.dataRoot);
			if (!unlock) {
				throw new Error('Maintenance is running. Retry rollback after it completes.');
			}
			try {
				validateRelease(state.previous);
				saveJson(statePath, { ...state, pending: state.previous });
				saveJson(path.join(config.dataRoot, 'config.json'), { ...config, autoUpdate: false });
				console.log('Rollback is queued for the next full restart. Automatic updates are paused.');
			} finally {
				unlock();
			}
			break;
		}
		default:
			throw new Error(`Unknown command: ${command}. Use init, status, check, update, sync, launch, extensions, or rollback.`);
	}
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
	main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonc(text, description, expectArray = false) {
	const errors = [];
	const value = jsonc.parse(text.trim() || (expectArray ? '[]' : '{}'), errors, { allowTrailingComma: true });
	if (errors.length || (expectArray ? !Array.isArray(value) : !isRecord(value))) {
		throw new Error(`${description} contains invalid JSONC or has the wrong top-level type; nothing was synchronized.`);
	}
	return value;
}

function readOptional(filePath, fallback) {
	return existsSync(filePath) ? readFileSync(filePath, 'utf8') : fallback;
}

function writeAtomic(filePath, contents) {
	mkdirSync(path.dirname(filePath), { recursive: true });
	const temporary = `${filePath}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, contents, { flag: 'wx' });
		renameSync(temporary, filePath);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function mergeRecords(source, overrides) {
	return Object.fromEntries([...new Set([...Object.keys(source), ...Object.keys(overrides)])].map(key => {
		const value = Object.hasOwn(overrides, key)
			? (isRecord(source[key]) && isRecord(overrides[key]) ? mergeRecords(source[key], overrides[key]) : overrides[key])
			: source[key];
		return [key, value];
	}));
}

export function mergeSettingsText(sourceText, overrideText) {
	const source = readJsonc(sourceText, 'VS Code settings');
	const overrides = readJsonc(overrideText, 'FreedomEditor settings overrides');
	let result = sourceText.trim() ? sourceText : '{}\n';
	for (const [key, value] of Object.entries(mergeRecords(source, overrides))) {
		if (!isDeepStrictEqual(value, source[key])) {
			result = jsonc.applyEdits(result, jsonc.modify(result, [key], value, {
				formattingOptions: { insertSpaces: false, tabSize: 4, eol: '\n' }
			}));
		}
	}
	return result;
}

function snippetFiles(directory, relative = '') {
	const result = new Map();
	if (!existsSync(directory)) {
		return result;
	}
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const relativePath = path.join(relative, entry.name);
		if (entry.isDirectory()) {
			for (const [name, contents] of snippetFiles(path.join(directory, entry.name), relativePath)) {
				result.set(name, contents);
			}
		} else if (entry.isFile() && /\.(json|code-snippets)$/i.test(entry.name)) {
			result.set(relativePath, readFileSync(path.join(directory, entry.name)));
		}
	}
	return result;
}

export function initializeProfileOverrides(config) {
	const overridesRoot = path.join(config.dataRoot, 'overrides');
	const marker = path.join(overridesRoot, 'initialized.json');
	if (existsSync(marker)) {
		return;
	}
	const settings = readJsonc(readOptional(path.join(config.officialUserRoot, 'settings.json'), '{}'), 'VS Code settings');
	const current = readJsonc(readOptional(path.join(config.profileRoot, 'User/settings.json'), '{}'), 'FreedomEditor settings');
	const bindings = readJsonc(readOptional(path.join(config.officialUserRoot, 'keybindings.json'), '[]'), 'VS Code keybindings', true);
	const currentBindings = readJsonc(readOptional(path.join(config.profileRoot, 'User/keybindings.json'), '[]'), 'FreedomEditor keybindings', true);
	const overrides = Object.fromEntries(Object.entries(current).filter(([key, value]) => !isDeepStrictEqual(settings[key], value)));
	const bindingOverrides = currentBindings.filter(binding => !bindings.some(source => isDeepStrictEqual(binding, source)));
	const sourceSnippets = snippetFiles(path.join(config.officialUserRoot, 'snippets'));
	for (const [relative, contents] of snippetFiles(path.join(config.profileRoot, 'User/snippets'))) {
		if (!contents.equals(sourceSnippets.get(relative) ?? Buffer.alloc(0))) {
			const target = path.join(overridesRoot, 'snippets', relative);
			if (!existsSync(target)) {
				writeAtomic(target, contents);
			}
		}
	}
	for (const [name, value] of [['settings.json', overrides], ['keybindings.json', bindingOverrides]]) {
		const target = path.join(overridesRoot, name);
		if (!existsSync(target)) {
			writeAtomic(target, `${JSON.stringify(value, null, '\t')}\n`);
		}
	}
	writeAtomic(marker, `${JSON.stringify({ capturedAt: new Date().toISOString() }, null, '\t')}\n`);
}

export function syncProfile(config) {
	if (!existsSync(config.officialUserRoot)) {
		throw new Error(`VS Code user settings directory not found: ${config.officialUserRoot}`);
	}
	if (path.resolve(config.officialUserRoot).toLowerCase() === path.resolve(config.profileRoot, 'User').toLowerCase()) {
		throw new Error('Source and destination profiles must be separate.');
	}
	initializeProfileOverrides(config);
	const overridesRoot = path.join(config.dataRoot, 'overrides');
	const desired = new Map();
	const settings = mergeSettingsText(
		readOptional(path.join(config.officialUserRoot, 'settings.json'), '{}\n'),
		readOptional(path.join(overridesRoot, 'settings.json'), '{}')
	);
	desired.set('settings.json', Buffer.from(settings));
	const bindingText = readOptional(path.join(config.officialUserRoot, 'keybindings.json'), '[]\n');
	const bindings = readJsonc(bindingText, 'VS Code keybindings', true);
	const bindingOverrides = readJsonc(readOptional(path.join(overridesRoot, 'keybindings.json'), '[]'), 'FreedomEditor keybindings overrides', true);
	const mergedBindings = [...bindings, ...bindingOverrides.filter(binding => !bindings.some(source => isDeepStrictEqual(binding, source)))];
	desired.set('keybindings.json', Buffer.from(bindingOverrides.length ? `${JSON.stringify(mergedBindings, null, '\t')}\n` : bindingText));
	for (const [relative, contents] of new Map([
		...snippetFiles(path.join(config.officialUserRoot, 'snippets')),
		...snippetFiles(path.join(overridesRoot, 'snippets'))
	])) {
		desired.set(path.join('snippets', relative), contents);
	}
	const indexPath = path.join(config.dataRoot, 'profile-files.json');
	const previous = JSON.parse(readOptional(indexPath, '[]'));
	for (const relative of previous) {
		if (typeof relative !== 'string' || !relative.startsWith(`snippets${path.sep}`) || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
			throw new Error('Invalid managed snippet path; nothing was synchronized.');
		}
		if (!desired.has(relative)) {
			desired.set(relative, null);
		}
	}
	const userRoot = path.join(config.profileRoot, 'User');
	const changes = [...desired].map(([relative, contents]) => {
		const target = path.join(userRoot, relative);
		const before = existsSync(target) ? readFileSync(target) : null;
		return { relative, target, before, contents };
	}).filter(change => !isDeepStrictEqual(change.before, change.contents));
	let backupRoot;
	if (changes.length) {
		backupRoot = path.join(config.dataRoot, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
		for (const change of changes) {
			if (change.before !== null) {
				writeAtomic(path.join(backupRoot, change.relative), change.before);
			}
		}
		writeAtomic(path.join(backupRoot, 'manifest.json'), JSON.stringify(changes.map(change => ({ path: change.relative, existed: change.before !== null })), null, '\t'));
		try {
			for (const change of changes) {
				if (change.contents === null) {
					rmSync(change.target);
				} else {
					writeAtomic(change.target, change.contents);
				}
			}
		} catch (error) {
			for (const change of changes) {
				if (change.before === null) {
					rmSync(change.target, { force: true });
				} else {
					writeAtomic(change.target, change.before);
				}
			}
			throw error;
		}
	}
	writeAtomic(indexPath, JSON.stringify([...desired].filter(([relative, contents]) => relative.startsWith(`snippets${path.sep}`) && contents !== null).map(([relative]) => relative)));
	return { changedFiles: changes.map(change => change.relative), backupRoot };
}

export function compareVersions(left, right) {
	for (const value of [left, right]) {
		if (!/^\d+\.\d+\.\d+$/.test(value)) {
			throw new Error(`Invalid stable version: ${value}`);
		}
	}
	const leftParts = left.split('.').map(Number);
	const rightParts = right.split('.').map(Number);
	for (let index = 0; index < leftParts.length; index++) {
		if (leftParts[index] !== rightParts[index]) {
			return Math.sign(leftParts[index] - rightParts[index]);
		}
	}
	return 0;
}

export function findOfficialCodeApp(installRoot) {
	if (!existsSync(installRoot)) {
		throw new Error(`Official VS Code installation not found: ${installRoot}`);
	}
	const candidates = [path.join(installRoot, 'resources', 'app')];
	for (const entry of readdirSync(installRoot, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			candidates.push(path.join(installRoot, entry.name, 'resources', 'app'));
		}
	}
	const installations = [];
	for (const appPath of candidates) {
		try {
			const manifest = JSON.parse(readFileSync(path.join(appPath, 'package.json'), 'utf8'));
			const product = JSON.parse(readFileSync(path.join(appPath, 'product.json'), 'utf8'));
			compareVersions(manifest.version, manifest.version);
			installations.push({ appPath, version: manifest.version, commit: product.commit });
		} catch {
			continue;
		}
	}
	installations.sort((left, right) => compareVersions(right.version, left.version));
	if (installations.length === 0) {
		throw new Error(`No complete stable VS Code installation found in ${installRoot}`);
	}
	return installations[0];
}