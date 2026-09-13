/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireLock, applyCustomizations, compareVersions, fetchOfficialSource, latestRelease, readJson, releaseDecision, run, saveJson, writeAtomic } from './freedomeditor-sync.mjs';
import protocol from '../freedomeditor/updater-extension/protocol.cjs';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(sourceRoot, 'freedomeditor', 'package.json'));
const semver = require('semver');
const identityKeys = ['nameShort', 'nameLong', 'applicationName', 'dataFolderName', 'sharedDataFolderName', 'urlProtocol', 'win32AppUserModelId', 'win32MutexName'];

export function readInstallation(installRoot) {
	const appRoot = path.join(installRoot, 'resources', 'app');
	const product = readJson(path.join(appRoot, 'product.json'));
	const manifest = readJson(path.join(appRoot, 'package.json'));
	compareVersions(manifest.version, manifest.version);
	if (product.nameShort !== 'FreedomEditor' || !existsSync(path.join(installRoot, 'FreedomEditor.exe'))) {
		throw new Error('The configured installation is not a complete FreedomEditor application.');
	}
	return {
		version: manifest.version,
		bootstrapVersion: manifest.freedomEditorUpdateBootstrap,
		identity: Object.fromEntries(identityKeys.map(key => [key, product[key]])),
		upstreamCommit: product.freedomEditorUpdate?.upstreamCommit,
		customizationCommit: product.freedomEditorUpdate?.customizationCommit
	};
}

export function installBootstrap(installRoot) {
	readInstallation(installRoot);
	const appRoot = path.join(installRoot, 'resources', 'app');
	const manifestPath = path.join(appRoot, 'package.json');
	const manifest = readJson(manifestPath);
	const entry = './freedomeditor/updater-bootstrap.mjs';
	if (!['./out/main.js', entry].includes(manifest.main) || !existsSync(path.join(appRoot, 'node_modules.asar'))) {
		throw new Error('The packaged entry point or dependency layout is unsupported. No bootstrap was changed.');
	}
	for (const relative of ['updater-bootstrap.mjs', path.join('updater-extension', 'protocol.cjs')]) {
		writeAtomic(path.join(appRoot, 'freedomeditor', relative), readFileSync(path.join(sourceRoot, 'freedomeditor', relative)));
	}
	saveJson(manifestPath, { ...manifest, main: entry, freedomEditorUpdateBootstrap: 1 });
}

export function assertIdentity(expected, actual) {
	for (const key of identityKeys) {
		if (typeof expected?.[key] !== 'string' || actual?.[key] !== expected[key]) {
			throw new Error(`The update would change ${key}; automatic installation was refused to preserve the editor and its profile.`);
		}
	}
}

export async function hashFile(filePath) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(filePath)) {
		hash.update(chunk);
	}
	return hash.digest('hex');
}

function packageFile(file, packagesRoot, extension) {
	const directory = realpathSync(packagesRoot);
	const resolved = realpathSync(file);
	const relative = path.relative(directory, resolved);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(resolved).toLowerCase() !== extension) {
		throw new Error('The update file is outside the private update package directory.');
	}
	return resolved;
}

export async function verifyPackage(release, packagesRoot, requirePayload = false) {
	compareVersions(release.version, release.version);
	if (!/^[a-f0-9]{40}$/i.test(release.upstreamCommit ?? '') || !/^[a-f0-9]{64}$/i.test(release.sha256 ?? '') ||
		!/^[a-f0-9]{64}$/i.test(release.executableSha256 ?? '')) {
		throw new Error('The staged update has invalid source or integrity metadata.');
	}
	const installer = packageFile(release.installer, packagesRoot, '.exe');
	if (await hashFile(installer) !== release.sha256) {
		throw new Error('The update installer checksum does not match. Nothing was installed.');
	}
	if (requirePayload || release.payload) {
		if (!/^[a-f0-9]{64}$/i.test(release.payloadSha256 ?? '') ||
			await hashFile(packageFile(release.payload, packagesRoot, '.json')) !== release.payloadSha256) {
			throw new Error('The update payload manifest is missing or has an invalid checksum.');
		}
	}
}

async function recordPayload(packageRoot, release) {
	const files = {};
	const visit = async directory => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(file);
			} else if (entry.isFile()) {
				if (!/\.(js|mjs|cjs|css|ts|mts|cts)\.map$/i.test(entry.name)) {
					files[path.relative(packageRoot, file)] = await hashFile(file);
				}
			} else {
				throw new Error(`The production payload contains an unsupported filesystem entry: ${file}`);
			}
		}
	};
	await visit(packageRoot);
	const payload = `${release.installer}.files.json`;
	saveJson(payload, { schemaVersion: 1, files });
	return { ...release, payload, payloadSha256: await hashFile(payload) };
}

export async function verifyInstalledPayload(release, installRoot, paths) {
	const receipt = readJson(paths.receipt);
	if (receipt.schemaVersion !== 1 || receipt.sha256 !== release.sha256 ||
		receipt.version !== release.version || receipt.upstreamCommit !== release.upstreamCommit) {
		throw new Error('No successful installer completion was recorded for this update. Automatic updates must remain paused for recovery.');
	}
	await verifyPackage(release, paths.packages, true);
	const manifest = readJson(release.payload);
	if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || !Object.keys(manifest.files).length) {
		throw new Error('The update payload manifest is invalid.');
	}
	for (const [relative, expected] of Object.entries(manifest.files)) {
		const file = path.resolve(installRoot, relative);
		const inside = path.relative(installRoot, file);
		if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !/^[a-f0-9]{64}$/i.test(expected)) {
			throw new Error('The update payload contains an invalid file identity.');
		}
		if (await hashFile(file) !== expected) {
			throw new Error(`The installed payload does not match the validated package: ${relative}`);
		}
	}
}

async function retainPackage(installer, release, packagesRoot) {
	mkdirSync(packagesRoot, { recursive: true });
	const sha256 = await hashFile(installer);
	const target = path.join(packagesRoot, `${release.version}-${sha256}.exe`);
	if (!existsSync(target)) {
		copyFileSync(installer, target);
	}
	const result = { ...release, installer: target, sha256 };
	await verifyPackage(result, packagesRoot);
	return result;
}

function runAsync(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { windowsHide: true, stdio: 'inherit', ...options });
		child.once('error', reject);
		child.once('close', code => resolve(code));
	});
}

function snapshotCustomizations(config) {
	const options = { cwd: config.sourceRoot };
	run('git', ['check-ref-format', config.sourceRef], options);
	const revision = run('git', ['rev-parse', '--verify', `${config.sourceRef}^{commit}`], options);
	run('git', ['merge-base', '--is-ancestor', config.upstreamBase, revision], options);
	const product = JSON.parse(run('git', ['show', `${revision}:product.json`], options));
	assertIdentity(config.identity, product);
	for (const file of ['scripts/freedomeditor-auto-update.mjs', 'scripts/freedomeditor-apply-update.ps1', 'freedomeditor/updater-bootstrap.mjs']) {
		run('git', ['cat-file', '-e', `${revision}:${file}`], options);
	}
	return revision;
}

async function buildCandidate(config, latest, paths, publish) {
	const customizationCommit = snapshotCustomizations(config);
	const upstreamCommit = fetchOfficialSource(config, latest);
	mkdirSync(config.buildRoot, { recursive: true });
	const container = mkdtempSync(path.join(config.buildRoot, 'u'));
	const candidateRoot = path.join(container, 'src');
	const packageRoot = path.join(container, 'VSCode-win32-x64');
	publish({ phase: 'building', staging: container, customizationCommit });
	run('git', ['-c', 'core.longpaths=true', 'worktree', 'add', '--detach', candidateRoot, upstreamCommit], { cwd: config.sourceRoot, timeout: 180_000 });
	applyCustomizations(config, candidateRoot, customizationCommit);
	const candidateProduct = readJson(path.join(candidateRoot, 'product.json'));
	assertIdentity(config.identity, candidateProduct);
	candidateProduct.freedomEditorUpdate = { upstreamCommit, customizationCommit };
	saveJson(path.join(candidateRoot, 'product.json'), candidateProduct);

	const requiredNode = readFileSync(path.join(candidateRoot, '.nvmrc'), 'utf8').trim();
	const actualNode = run(config.nodePath, ['--version']).replace(/^v/, '');
	if (!semver.satisfies(actualNode, `>=${requiredNode} <${semver.major(requiredNode) + 1}.0.0`)) {
		throw new Error(`VS Code ${latest.productVersion} requires Node ${requiredNode} in the same major version. The installed editor is unchanged.`);
	}
	const environment = protocol.workerEnvironment();
	environment.PATH = `${path.dirname(config.nodePath)}${path.delimiter}${environment.PATH ?? ''}`;
	environment.GIT_TERMINAL_PROMPT = '0';
	const buildCode = await runAsync('powershell.exe', [
		'-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
		'-File', path.join(candidateRoot, 'scripts', 'freedomeditor-build.ps1'),
		'-NodePath', config.nodePath, '-SignToolPath', config.signToolPath
	], { cwd: candidateRoot, env: environment });
	if (buildCode !== 0) {
		throw new Error(`The patched production build failed (exit ${buildCode}). See the update log; the installed editor is unchanged.`);
	}
	publish({ phase: 'validating' });
	const isolatedExtensions = path.join(container, 'validation-extensions');
	mkdirSync(isolatedExtensions);
	const smokeCode = await runAsync(config.nodePath, [
		path.join(candidateRoot, 'scripts', 'freedomeditor-smoke.mjs'),
		'--executable', path.join(packageRoot, 'FreedomEditor.exe'), '--extensions-dir', isolatedExtensions
	], { cwd: candidateRoot, env: environment });
	if (smokeCode !== 0) {
		throw new Error(`The patched editor did not pass its desktop startup checks (exit ${smokeCode}). Nothing was installed.`);
	}
	const candidate = readInstallation(packageRoot);
	assertIdentity(config.identity, candidate.identity);
	if (candidate.version !== latest.productVersion || candidate.upstreamCommit !== upstreamCommit || candidate.bootstrapVersion !== 1) {
		throw new Error('The built application does not match the verified official release and native update launch gate.');
	}
	const installer = path.join(candidateRoot, '.freedomeditor', 'artifacts', `FreedomEditorSetup-x64-${candidate.version}.exe`);
	const expectedHash = readFileSync(`${installer}.sha256`, 'utf8').trim().split(/\s+/)[0];
	if (await hashFile(installer) !== expectedHash) {
		throw new Error('The production installer checksum is invalid.');
	}
	const pending = await recordPayload(packageRoot, await retainPackage(installer, {
		version: candidate.version, upstreamCommit, customizationCommit,
		executableSha256: await hashFile(path.join(packageRoot, 'FreedomEditor.exe'))
	}, paths.packages));

	// Only generated worktrees and their own build output are removed, never the customization checkout.
	run('git', ['worktree', 'remove', '--force', candidateRoot], { cwd: config.sourceRoot, timeout: 180_000 });
	rmSync(container, { recursive: true });
	return pending;
}

async function applyCandidate(config, configPath, pending) {
	return runAsync('powershell.exe', [
		'-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
		'-File', path.join(config.sourceRoot, 'scripts', 'freedomeditor-apply-update.ps1'),
		'-ConfigPath', configPath, '-InstallerPath', pending.installer, '-ExpectedHash', pending.sha256
	], { cwd: config.sourceRoot, env: protocol.workerEnvironment() });
}

/**
 * The state machine has injectable effects so safety boundaries can be exercised without installing software.
 */
export async function performUpdate(config, state, effects, checkOnly = false) {
	let applying = false;
	const publish = changes => {
		Object.assign(state, changes, { updatedAt: new Date().toISOString() });
		effects.save(state);
	};
	try {
		const installed = effects.inspect();
		assertIdentity(config.identity, installed.identity);
		if (config.gateMutexName && installed.bootstrapVersion !== 1) {
			throw new Error('The installed native update launch gate is missing. Reconfigure automatic updates before continuing.');
		}
		if (state.pending && installed.version === state.pending.version && installed.upstreamCommit === state.pending.upstreamCommit) {
			applying = true;
			await effects.verify(state.pending);
			if (await effects.executableHash() !== state.pending.executableSha256) {
				throw new Error('The interrupted installation does not match its validated executable.');
			}
			await effects.verifyInstalled(state.pending);
			publish({ phase: 'installed', previous: state.current, current: state.pending, pending: null, lastError: null });
			return state;
		}
		if (!state.current || installed.version !== state.current.version ||
			(installed.upstreamCommit && installed.upstreamCommit !== state.current.upstreamCommit)) {
			throw new Error('The installed version differs from the recorded update baseline. Reconfigure automatic updates before continuing.');
		}
		if (await effects.executableHash() !== state.current.executableSha256) {
			throw new Error('The installed executable differs from the recorded update baseline. Automatic replacement was refused.');
		}
		if (!effects.enabled() && !checkOnly) {
			publish({ phase: 'paused' });
			return state;
		}
		publish({ phase: 'checking', lastError: null });
		if (!state.pending || checkOnly) {
			const latest = await effects.latest();
			const decision = releaseDecision(state.current, latest);
			publish({ latestVersion: latest.productVersion, lastCheck: new Date().toISOString() });
			if (decision !== 'update') {
				publish({ phase: decision === 'ahead' ? 'ahead' : 'current' });
				return state;
			}
			if (checkOnly) {
				publish({ phase: 'available' });
				return state;
			}
			// A verified recovery package must exist before any new build can replace the current application.
			await effects.verify(state.current);
			if (!effects.enabled()) {
				publish({ phase: 'paused' });
				return state;
			}
			const pending = await effects.build(latest, publish);
			if (pending.version !== latest.productVersion || pending.upstreamCommit !== latest.version) {
				throw new Error('The staged update does not match the official release that was checked.');
			}
			publish({ pending, phase: 'ready', staging: null });
		}
		if (compareVersions(state.pending.version, state.current.version) <= 0) {
			throw new Error('An automatic update may not reinstall or downgrade the current version.');
		}
		await effects.verify(state.pending);
		await effects.verify(state.current);
		if (!effects.enabled()) {
			publish({ phase: 'paused' });
			return state;
		}
		publish({ phase: 'waiting-for-close' });
		applying = true;
		const result = await effects.apply(state.pending);
		if (result === 10 || result === 11) {
			publish({ phase: result === 10 ? 'paused' : 'ready' });
			return state;
		}
		if (result !== 0) {
			throw new Error(`Update installation failed (exit ${result}). Automatic updates have been paused. The staged update and recovery installer are retained; inspect the update log before retrying.`);
		}
		const after = effects.inspect();
		assertIdentity(config.identity, after.identity);
		if (after.version !== state.pending.version || after.upstreamCommit !== state.pending.upstreamCommit ||
			await effects.executableHash() !== state.pending.executableSha256) {
			throw new Error('The installed update did not match the validated package. Automatic updates have been paused; use the retained recovery installer.');
		}
		await effects.verifyInstalled(state.pending);
		publish({ phase: 'installed', previous: state.current, current: state.pending, pending: null, lastError: null });
		return state;
	} catch (error) {
		if (applying) {
			effects.pause();
		}
		publish({ phase: 'error', lastError: error.message });
		throw error;
	}
}

export async function runUpdate(configPath, checkOnly = false, overrides = {}) {
	const config = protocol.validateConfiguration(readJson(configPath));
	const paths = protocol.updatePaths(configPath);
	const unlock = acquireLock(path.join(config.sourceRoot, '.freedomeditor'));
	if (!unlock) {
		console.log('FreedomEditor maintenance is already running.');
		return;
	}
	try {
		const state = readJson(paths.state);
		return await performUpdate(config, state, {
			save: value => {
				saveJson(paths.state, value);
				console.log(`${value.updatedAt} ${value.phase}: ${value.latestVersion ?? value.current?.version ?? ''}`);
				if (value.staging) {
					console.log(`Build directory: ${value.staging}`);
				}
				if (value.phase === 'error') {
					console.error(value.lastError);
					console.error(`Recovery installer: ${value.current?.installer ?? 'not configured'}`);
				}
			},
			inspect: () => readInstallation(config.installRoot),
			enabled: () => protocol.validateConfiguration(readJson(configPath)).enabled,
			latest: latestRelease,
			verify: release => verifyPackage(release, paths.packages, release === state.pending),
			verifyInstalled: release => verifyInstalledPayload(release, config.installRoot, paths),
			build: (latest, publish) => buildCandidate(config, latest, paths, publish),
			apply: pending => applyCandidate(config, configPath, pending),
			executableHash: () => hashFile(path.join(config.installRoot, 'FreedomEditor.exe')),
			pause: () => saveJson(configPath, { ...protocol.validateConfiguration(readJson(configPath)), enabled: false }),
			...overrides
		}, checkOnly);
	} finally {
		unlock();
	}
}

function option(args, name) {
	const index = args.indexOf(name);
	if (index < 0) {
		return undefined;
	}
	if (!args[index + 1] || args[index + 1].startsWith('--')) {
		throw new Error(`A value is required for ${name}.`);
	}
	return args[index + 1];
}

async function configure(configPath, args) {
	const local = readJson(path.join(sourceRoot, '.freedomeditor', 'config.json'));
	const installRoot = realpathSync(option(args, '--install-root') ?? path.join(process.env.LOCALAPPDATA, 'Programs', 'FreedomEditor'));
	const installed = readInstallation(installRoot);
	const sourceRef = option(args, '--source-ref') ?? run('git', ['symbolic-ref', '--quiet', 'HEAD']);
	const config = {
		schemaVersion: 1, enabled: !args.includes('--paused'), channel: 'stable',
		sourceRoot, sourceRef, upstreamBase: local.upstreamBase, installRoot,
		nodePath: local.nodePath,
		signToolPath: option(args, '--sign-tool') ?? local.signToolPath,
		buildRoot: path.resolve(option(args, '--build-root') ?? path.join(sourceRoot, '.build')),
		gateMutexName: protocol.updateGateName(installRoot),
		identity: installed.identity
	};
	protocol.validateConfiguration(config);
	for (const file of [config.nodePath, config.signToolPath]) {
		if (!statSync(file).isFile()) {
			throw new Error(`A required build tool is not a file: ${file}`);
		}
	}
	snapshotCustomizations(config);
	const paths = protocol.updatePaths(configPath);
	if (existsSync(paths.state)) {
		const existing = readJson(paths.state);
		if (existing.current?.version !== installed.version ||
			(installed.upstreamCommit && existing.current.upstreamCommit !== installed.upstreamCommit) ||
			existing.current.executableSha256 !== await hashFile(path.join(installRoot, 'FreedomEditor.exe'))) {
			throw new Error('The recorded baseline differs from the installed version. Keep the existing recovery data and resolve this difference before reconfiguring.');
		}
		await verifyPackage(existing.current, paths.packages);
		if (existing.pending) {
			saveJson(paths.state, { ...existing, phase: 'configured', pending: null, lastError: null, updatedAt: new Date().toISOString() });
			console.log('The queued update was cleared so the next build uses the newly configured customization snapshot. Its installer remains retained.');
		}
	} else {
		let upstreamCommit = installed.upstreamCommit;
		if (!upstreamCommit) {
			const base = JSON.parse(run('git', ['show', `${config.upstreamBase}:package.json`]));
			if (base.version !== installed.version) {
				throw new Error('The installed upstream base cannot be inferred safely from this customization checkout.');
			}
			upstreamCommit = config.upstreamBase;
		}
		const installer = option(args, '--recovery-installer') ??
			path.join(sourceRoot, '.freedomeditor', 'artifacts', `FreedomEditorSetup-x64-${installed.version}.exe`);
		const checksumPath = `${installer}.sha256`;
		if (!existsSync(checksumPath) || await hashFile(installer) !== readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]) {
			throw new Error('A matching recovery installer and SHA-256 file are required before enabling automatic updates.');
		}
		const current = await retainPackage(installer, {
			version: installed.version, upstreamCommit,
			executableSha256: await hashFile(path.join(installRoot, 'FreedomEditor.exe'))
		}, paths.packages);
		saveJson(paths.state, { phase: 'configured', current, pending: null, previous: null, updatedAt: new Date().toISOString() });
	}
	installBootstrap(installRoot);
	saveJson(configPath, config);
	console.log(`Configured official stable source updates for FreedomEditor ${installed.version}.`);
	console.log(`Configuration: ${configPath}`);
}

async function main() {
	const [action = 'status', ...args] = process.argv.slice(2);
	const configPath = path.resolve(option(args, '--config') ?? protocol.configurationPath());
	switch (action) {
		case 'bootstrap':
			installBootstrap(path.resolve(option(args, '--install-root')));
			break;
		case 'configure':
			{
				if (configPath.toLowerCase() !== path.resolve(protocol.configurationPath()).toLowerCase()) {
					throw new Error('Native startup integration requires the default machine-private configuration path. Custom --config locations cannot be configured.');
				}
				const unlock = acquireLock(path.join(sourceRoot, '.freedomeditor'));
				if (!unlock) {
					throw new Error('FreedomEditor maintenance is running. Pause updates and wait for it to finish before reconfiguring.');
				}
				try {
					await configure(configPath, args);
				} finally {
					unlock();
				}
			}
			break;
		case 'update':
		case 'check':
			await runUpdate(configPath, action === 'check');
			break;
		case 'pause':
		case 'resume': {
			const config = protocol.validateConfiguration(readJson(configPath));
			saveJson(configPath, { ...config, enabled: action === 'resume' });
			console.log(action === 'pause' ? 'Automatic updates are paused. A running build may finish, but it will not be installed.' : 'Automatic updates are enabled.');
			if (action === 'resume') {
				await runUpdate(configPath);
			}
			break;
		}
		case 'status':
			console.log(JSON.stringify(readJson(protocol.updatePaths(configPath).state), null, 2));
			break;
		default:
			throw new Error('Use configure, update, check, pause, resume, or status.');
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
