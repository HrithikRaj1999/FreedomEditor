/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import { hashFile, installBootstrap, performUpdate, runUpdate, verifyInstalledPayload, verifyPackage } from './freedomeditor-auto-update.mjs';
import { applyCustomizations, readJson, run, saveJson } from './freedomeditor-sync.mjs';
import protocol from '../freedomeditor/updater-extension/protocol.cjs';

const identity = {
	nameShort: 'FreedomEditor', nameLong: 'FreedomEditor', applicationName: 'freedomeditor',
	dataFolderName: '.freedom-editor', sharedDataFolderName: '.freedom-editor-shared',
	urlProtocol: 'freedomeditor', win32AppUserModelId: 'FreedomEditor', win32MutexName: 'freedomeditor'
};
const current = { version: '1.137.0', upstreamCommit: 'a'.repeat(40), executableSha256: '1'.repeat(64) };
const pending = { version: '1.137.1', upstreamCommit: 'b'.repeat(40), executableSha256: '2'.repeat(64) };

function harness() {
	let installed = { ...current, identity };
	let enabled = true;
	const calls = [];
	const state = { current: { ...current }, pending: null, previous: null };
	const config = { identity };
	const effects = {
		save: () => {},
		inspect: () => installed,
		enabled: () => enabled,
		latest: async () => ({ productVersion: pending.version, version: pending.upstreamCommit }),
		verify: async value => { calls.push(`verify:${value.version}`); },
		verifyInstalled: async () => {},
		build: async () => { calls.push('build'); return { ...pending }; },
		apply: async value => { calls.push('apply'); installed = { ...value, identity }; return 0; },
		executableHash: async () => installed.executableSha256,
		pause: () => { enabled = false; calls.push('pause'); }
	};
	return { config, state, effects, calls, setInstalled: value => { installed = value; }, isEnabled: () => enabled };
}

test('an unchanged official release never builds or installs', async () => {
	const h = harness();
	h.effects.latest = async () => ({ productVersion: current.version, version: current.upstreamCommit });
	await performUpdate(h.config, h.state, h.effects);
	assert.deepEqual({ phase: h.state.phase, calls: h.calls, current: h.state.current }, { phase: 'current', calls: [], current });
});

test('manual checks report an available release without changing the installation', async () => {
	const h = harness();
	await performUpdate(h.config, h.state, h.effects, true);
	assert.deepEqual({ phase: h.state.phase, calls: h.calls, current: h.state.current }, { phase: 'available', calls: [], current });
});

test('the current recovery package is verified before building and applying an update', async () => {
	const h = harness();
	await performUpdate(h.config, h.state, h.effects);
	assert.deepEqual(h.calls, ['verify:1.137.0', 'build', 'verify:1.137.1', 'verify:1.137.0', 'apply']);
	assert.deepEqual({ phase: h.state.phase, current: h.state.current, previous: h.state.previous, pending: h.state.pending },
		{ phase: 'installed', current: pending, previous: current, pending: null });
});

test('a conflicting customization or failed build leaves the installed editor untouched', async () => {
	const h = harness();
	h.effects.build = async () => { throw new Error('customization conflict'); };
	await assert.rejects(performUpdate(h.config, h.state, h.effects), /customization conflict/);
	assert.deepEqual({ phase: h.state.phase, current: h.state.current, pending: h.state.pending, calls: h.calls },
		{ phase: 'error', current, pending: null, calls: ['verify:1.137.0'] });
});

test('unverified, same-version replacement, or downgraded sources cannot be installed', async () => {
	for (const latest of [
		{ productVersion: '1.137.0', version: 'b'.repeat(40) },
		{ productVersion: '1.138.0', version: 'invalid' }
	]) {
		const h = harness();
		h.effects.latest = async () => latest;
		await assert.rejects(performUpdate(h.config, h.state, h.effects));
		assert.deepEqual(h.calls, []);
	}
	const h = harness();
	h.effects.latest = async () => ({ productVersion: '1.136.0', version: 'c'.repeat(40) });
	await performUpdate(h.config, h.state, h.effects);
	assert.deepEqual({ phase: h.state.phase, calls: h.calls }, { phase: 'ahead', calls: [] });
});

test('a staged package must match the exact verified source release', async () => {
	const h = harness();
	h.effects.build = async () => ({ ...pending, upstreamCommit: 'c'.repeat(40) });
	await assert.rejects(performUpdate(h.config, h.state, h.effects), /does not match the official release/);
	assert.equal(h.calls.includes('apply'), false);
});

test('pausing or Windows shutdown preserves the staged update without marking it installed', async () => {
	for (const [result, phase] of [[10, 'paused'], [11, 'ready']]) {
		const h = harness();
		h.state.pending = { ...pending };
		h.effects.apply = async () => result;
		await performUpdate(h.config, h.state, h.effects);
		assert.deepEqual({ phase: h.state.phase, current: h.state.current, pending: h.state.pending },
			{ phase, current, pending });
	}
});

test('paused automatic updates perform no network, build, or install work', async () => {
	const h = harness();
	h.effects.enabled = () => false;
	h.effects.latest = async () => { throw new Error('must not check'); };
	await performUpdate(h.config, h.state, h.effects);
	assert.deepEqual({ phase: h.state.phase, calls: h.calls }, { phase: 'paused', calls: [] });
});

test('an installer failure pauses future automatic attempts and retains recovery data', async () => {
	const h = harness();
	h.effects.apply = async () => 5;
	await assert.rejects(performUpdate(h.config, h.state, h.effects), /installation failed/);
	assert.deepEqual({ enabled: h.isEnabled(), phase: h.state.phase, current: h.state.current, pending: h.state.pending },
		{ enabled: false, phase: 'error', current, pending });
});

test('an unexpected installed identity is refused before checking the network', async () => {
	const h = harness();
	h.setInstalled({ ...current, identity: { ...identity, dataFolderName: '.vscode' } });
	await assert.rejects(performUpdate(h.config, h.state, h.effects), /would change dataFolderName/);
	assert.deepEqual(h.calls, []);
});

test('an executable mismatch after installation pauses updates', async () => {
	const h = harness();
	let inspected = false;
	h.effects.executableHash = async () => {
		if (inspected) {
			return '0'.repeat(64);
		}
		inspected = true;
		return current.executableSha256;
	};
	await assert.rejects(performUpdate(h.config, h.state, h.effects), /did not match/);
	assert.equal(h.isEnabled(), false);
	assert.equal(h.state.current.version, current.version);
});

test('a crash after successful installation can be reconciled without reinstalling', async () => {
	const h = harness();
	h.state.pending = { ...pending };
	h.setInstalled({ ...pending, identity });
	await performUpdate(h.config, h.state, h.effects);
	assert.deepEqual({ phase: h.state.phase, current: h.state.current, previous: h.state.previous, calls: h.calls },
		{ phase: 'installed', current: pending, previous: current, calls: ['verify:1.137.1'] });
});

test('interrupted copying cannot be accepted as a completed installation', async () => {
	const h = harness();
	h.state.pending = { ...pending };
	h.setInstalled({ ...pending, identity });
	h.effects.verifyInstalled = async () => { throw new Error('No successful installer completion'); };
	await assert.rejects(performUpdate(h.config, h.state, h.effects), /No successful installer completion/);
	assert.equal(h.isEnabled(), false);
	assert.deepEqual(h.state.current, current);
	assert.deepEqual(h.state.pending, pending);
});

function fixture(context) {
	const root = path.resolve(import.meta.dirname, '..', '.freedomeditor', 'tests');
	mkdirSync(root, { recursive: true });
	const directory = mkdtempSync(path.join(root, 'auto-update-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

test('installer checksums and private package boundaries are enforced', async context => {
	const directory = fixture(context);
	const packages = path.join(directory, 'packages');
	mkdirSync(packages);
	const installer = path.join(packages, 'validated.exe');
	writeFileSync(installer, 'MZ validation fixture');
	const release = { ...pending, installer, sha256: await hashFile(installer) };
	await verifyPackage(release, packages);
	writeFileSync(installer, 'MZ changed contents');
	await assert.rejects(verifyPackage(release, packages), /checksum/);
	const outside = path.join(directory, 'outside.exe');
	writeFileSync(outside, 'MZ validation fixture');
	await assert.rejects(verifyPackage({ ...release, installer: outside }, packages), /outside/);
});

test('committed customizations are overlaid without deploying work-in-progress or editing the checkout', context => {
	const directory = fixture(context);
	const checkout = path.join(directory, 'checkout');
	const candidate = path.join(directory, 'candidate');
	mkdirSync(checkout);
	const git = args => run('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=FreedomEditor Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: checkout });
	git(['init', '--quiet', '-b', 'customizations']);
	git(['config', 'core.autocrlf', 'false']);
	writeFileSync(path.join(checkout, 'feature.txt'), 'upstream\n\n');
	git(['add', 'feature.txt']);
	git(['commit', '--quiet', '-m', 'upstream']);
	const base = git(['rev-parse', 'HEAD']);
	writeFileSync(path.join(checkout, 'feature.txt'), 'FreedomEditor customization\n\n');
	git(['commit', '--quiet', '-am', 'customize']);
	const revision = git(['rev-parse', 'HEAD']);
	writeFileSync(path.join(checkout, 'feature.txt'), 'unfinished local edit\n');
	writeFileSync(path.join(checkout, 'untracked.txt'), 'private work in progress');
	git(['worktree', 'add', '--detach', candidate, base]);
	applyCustomizations({ sourceRoot: checkout, upstreamBase: base }, candidate, revision);
	assert.equal(readFileSync(path.join(candidate, 'feature.txt'), 'utf8'), 'FreedomEditor customization\n\n');
	assert.equal(existsSync(path.join(candidate, 'untracked.txt')), false);
	assert.equal(readFileSync(path.join(checkout, 'feature.txt'), 'utf8'), 'unfinished local edit\n');
	assert.equal(git(['rev-parse', 'HEAD']), revision);
});

async function nativeFixture(context, realExecutable = false) {
	const root = fixture(context);
	const installRoot = path.join(root, 'installed');
	const appRoot = path.join(installRoot, 'resources', 'app');
	mkdirSync(appRoot, { recursive: true });
	const executable = path.join(installRoot, 'FreedomEditor.exe');
	if (realExecutable) {
		copyFileSync(process.execPath, executable);
	} else {
		writeFileSync(executable, 'MZ executable fixture');
	}
	saveJson(path.join(appRoot, 'product.json'), identity);
	saveJson(path.join(appRoot, 'package.json'), { version: current.version, type: 'module', main: './out/main.js' });
	writeFileSync(path.join(appRoot, 'node_modules.asar'), 'dependency archive fixture');
	installBootstrap(installRoot);
	installBootstrap(installRoot);
	assert.equal(readJson(path.join(appRoot, 'package.json')).main, './freedomeditor/updater-bootstrap.mjs');
	const directory = path.join(root, 'updates');
	const packages = path.join(directory, 'packages');
	mkdirSync(packages, { recursive: true });
	const installer = path.join(packages, 'never-executed.exe');
	writeFileSync(installer, 'MZ installer fixture - preflight must never execute this');
	const sha256 = await hashFile(installer);
	const config = {
		schemaVersion: 1, enabled: true, channel: 'stable', sourceRoot: root, sourceRef: 'refs/heads/customizations',
		upstreamBase: current.upstreamCommit, installRoot, nodePath: process.execPath,
		signToolPath: path.join(root, 'signtool.exe'), buildRoot: path.join(root, 'build'),
		identity, gateMutexName: protocol.updateGateName(installRoot)
	};
	const configPath = path.join(directory, 'config.json');
	const statePath = path.join(directory, 'state.json');
	saveJson(configPath, config);
	saveJson(statePath, {
		current: { ...current, installer, sha256, executableSha256: await hashFile(executable) },
		pending: { ...pending, installer, sha256 }, previous: null
	});
	const preflight = () => spawnSync('powershell.exe', [
		'-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
		'-File', path.join(import.meta.dirname, 'freedomeditor-apply-update.ps1'),
		'-ConfigPath', configPath, '-InstallerPath', installer, '-ExpectedHash', sha256, '-CheckOnly'
	], { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: protocol.workerEnvironment() });
	return { config, configPath, statePath, executable, preflight };
}

test('concurrent editor startups share one maintenance operation', async context => {
	const h = await nativeFixture(context);
	const state = readJson(h.statePath);
	saveJson(h.statePath, { ...state, pending: null });
	let finish;
	let started;
	const entered = new Promise(resolve => { started = resolve; });
	const latest = () => new Promise(resolve => { finish = resolve; started(); });
	const first = runUpdate(h.configPath, false, { latest });
	await entered;
	assert.equal(await runUpdate(h.configPath, false, { latest: () => { throw new Error('duplicate update'); } }), undefined);
	finish({ productVersion: current.version, version: current.upstreamCommit });
	await first;
	assert.equal(existsSync(path.join(h.config.sourceRoot, '.freedomeditor', 'maintenance.lock')), false);
});

test('Windows apply preflight validates the gate and refuses changed baselines or paused updates', { skip: process.platform !== 'win32' }, async context => {
	const h = await nativeFixture(context);
	let result = h.preflight();
	assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
	assert.match(result.stdout, /without running the installer/);
	saveJson(h.configPath, { ...h.config, enabled: false });
	result = h.preflight();
	assert.equal(result.status, 10, result.stderr);
	saveJson(h.configPath, h.config);
	writeFileSync(h.executable, 'MZ changed baseline');
	result = h.preflight();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /baseline changed/);
});

test('Windows apply preflight leaves a running installed process untouched', { skip: process.platform !== 'win32' }, async context => {
	const h = await nativeFixture(context, true);
	const child = spawn(h.executable, ['--eval', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
	await once(child, 'spawn');
	try {
		const result = h.preflight();
		assert.equal(result.status, 11, result.stderr);
		assert.match(result.stdout, /still running/);
		assert.equal(child.exitCode, null);
		assert.equal(process.kill(child.pid, 0), true);
	} finally {
		const exited = once(child, 'exit');
		child.kill();
		await exited;
	}
});

test('completed installation receipts still require every recorded payload file to match', async context => {
	const h = await nativeFixture(context);
	const paths = protocol.updatePaths(h.configPath);
	const release = readJson(h.statePath).pending;
	const payload = `${release.installer}.files.json`;
	saveJson(payload, { schemaVersion: 1, files: { 'FreedomEditor.exe': await hashFile(h.executable) } });
	const recorded = { ...release, payload, payloadSha256: await hashFile(payload) };
	saveJson(paths.receipt, { schemaVersion: 1, sha256: release.sha256, version: release.version, upstreamCommit: release.upstreamCommit });
	await verifyInstalledPayload(recorded, h.config.installRoot, paths);
	writeFileSync(h.executable, 'MZ incomplete payload');
	await assert.rejects(verifyInstalledPayload(recorded, h.config.installRoot, paths), /installed payload does not match/);
});
