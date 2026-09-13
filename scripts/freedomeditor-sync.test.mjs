import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { compareVersions, findOfficialCodeApp, launchEnvironment, launchWorkspaceArguments, mergeSettingsText, releaseDecision, selectRelease, syncProfile } from './freedomeditor-sync.mjs';

function fixture(context) {
	const runs = path.resolve(import.meta.dirname, '../.freedomeditor/tests');
	mkdirSync(runs, { recursive: true });
	const directory = mkdtempSync(path.join(runs, 'freedomeditor-sync-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

function addInstallation(directory, version) {
	const appPath = path.join(directory, 'resources', 'app');
	mkdirSync(appPath, { recursive: true });
	writeFileSync(path.join(appPath, 'package.json'), JSON.stringify({ version }));
	writeFileSync(path.join(appPath, 'product.json'), JSON.stringify({ commit: 'a'.repeat(40) }));
	return appPath;
}

test('compares stable versions numerically and rejects invalid releases', () => {
	assert.deepEqual([
		compareVersions('1.137.10', '1.137.2'),
		compareVersions('1.138.0', '1.137.9'),
		compareVersions('1.137.0', '1.137.0'),
		compareVersions('1.99.0', '1.137.0')
	], [1, 1, 0, -1]);
	assert.throws(() => compareVersions('1.138.0-insider', '1.137.0'), /Invalid stable version/);
});

test('Windows branding icon contains seven complete PNG-backed resolutions', () => {
	const icon = readFileSync(path.resolve(import.meta.dirname, '../resources/win32/code.ico'));
	assert.equal(icon.readUInt16LE(0), 0);
	assert.equal(icon.readUInt16LE(2), 1);
	const sizes = [16, 24, 32, 48, 64, 128, 256];
	assert.equal(icon.readUInt16LE(4), sizes.length);
	let end = 6 + sizes.length * 16;
	for (const [index, size] of sizes.entries()) {
		const entry = 6 + index * 16;
		const length = icon.readUInt32LE(entry + 8);
		const offset = icon.readUInt32LE(entry + 12);
		assert.equal(icon[entry] || 256, size);
		assert.equal(icon[entry + 1] || 256, size);
		assert.equal(offset, end);
		assert.ok(length > 24 && offset + length <= icon.length);
		assert.equal(icon.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
		assert.equal(icon.readUInt32BE(offset + 16), size);
		assert.equal(icon.readUInt32BE(offset + 20), size);
		end += length;
	}
	assert.equal(end, icon.length);
});

test('discovers a conventional VS Code installation', context => {
	const directory = fixture(context);
	const appPath = addInstallation(directory, '1.137.0');
	assert.equal(findOfficialCodeApp(directory).appPath, appPath);
});

test('discovers a newer versioned installation and ignores incomplete updates', context => {
	const directory = fixture(context);
	addInstallation(path.join(directory, 'old-build'), '1.137.0');
	const appPath = addInstallation(path.join(directory, 'new-build'), '1.137.2');
	mkdirSync(path.join(directory, 'unfinished-build', 'resources', 'app'), { recursive: true });
	assert.equal(findOfficialCodeApp(directory).appPath, appPath);
});

test('does not invent a path when VS Code is absent', context => {
	assert.throws(() => findOfficialCodeApp(fixture(context)), /No complete stable VS Code/);
});

test('merges settings overrides while retaining source comments and nested defaults', () => {
	const result = mergeSettingsText('{\n// original comment\n"editor.fontSize": 14,\n"[python]": { "editor.tabSize": 4 },\n}', '{"editor.fontSize": 16,"[python]":{"editor.formatOnSave":true}}');
	assert.match(result, /original comment/);
	assert.match(result, /"editor.tabSize": 4/);
	assert.match(result, /"editor.fontSize": 16/);
	assert.match(result, /"editor.formatOnSave": true/);
	assert.throws(() => mergeSettingsText('{broken', '{}'), /invalid JSONC/);
	assert.throws(() => mergeSettingsText('{}', '[]'), /wrong top-level type/);
});

function profileFixture(context) {
	const directory = fixture(context);
	const config = {
		officialUserRoot: path.join(directory, 'official/User'),
		profileRoot: path.join(directory, 'freedom'),
		dataRoot: path.join(directory, 'sync')
	};
	mkdirSync(path.join(config.officialUserRoot, 'snippets'), { recursive: true });
	mkdirSync(path.join(config.profileRoot, 'User/snippets'), { recursive: true });
	return config;
}

test('syncs one way, backs up originals, and preserves FreedomEditor overrides', context => {
	const config = profileFixture(context);
	const source = path.join(config.officialUserRoot, 'settings.json');
	const target = path.join(config.profileRoot, 'User/settings.json');
	writeFileSync(source, '{"editor.fontSize":14,"files.autoSave":"off"}');
	writeFileSync(target, '{"editor.fontSize":16}');
	writeFileSync(path.join(config.officialUserRoot, 'keybindings.json'), '[{"key":"ctrl+k","command":"official"}]');
	writeFileSync(path.join(config.profileRoot, 'User/keybindings.json'), '[{"key":"ctrl+k","command":"freedom"}]');
	writeFileSync(path.join(config.officialUserRoot, 'snippets/shared.json'), '{"source":{}}');
	writeFileSync(path.join(config.profileRoot, 'User/snippets/local.json'), '{"local":{}}');
	const result = syncProfile(config);
	assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { 'editor.fontSize': 16, 'files.autoSave': 'off' });
	assert.equal(readFileSync(path.join(result.backupRoot, 'settings.json'), 'utf8'), '{"editor.fontSize":16}');
	assert.equal(readFileSync(source, 'utf8'), '{"editor.fontSize":14,"files.autoSave":"off"}');
	assert.equal(JSON.parse(readFileSync(path.join(config.profileRoot, 'User/keybindings.json'), 'utf8')).at(-1).command, 'freedom');
	assert.ok(existsSync(path.join(config.profileRoot, 'User/snippets/shared.json')));
	assert.ok(existsSync(path.join(config.dataRoot, 'overrides/snippets/local.json')));
	assert.deepEqual(syncProfile(config).changedFiles, []);
	writeFileSync(source, '{"editor.fontSize":18,"files.autoSave":"afterDelay"}');
	syncProfile(config);
	assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { 'editor.fontSize': 16, 'files.autoSave': 'afterDelay' });
});

test('removes deleted managed snippets but retains local snippets', context => {
	const config = profileFixture(context);
	const source = path.join(config.officialUserRoot, 'snippets/managed.json');
	writeFileSync(source, '{}');
	writeFileSync(path.join(config.profileRoot, 'User/snippets/local.json'), '{}');
	syncProfile(config);
	rmSync(source);
	syncProfile(config);
	assert.equal(existsSync(path.join(config.profileRoot, 'User/snippets/managed.json')), false);
	assert.equal(existsSync(path.join(config.profileRoot, 'User/snippets/local.json')), true);
});

test('invalid source or overrides leave the destination untouched', context => {
	const config = profileFixture(context);
	syncProfile(config);
	const target = path.join(config.profileRoot, 'User/settings.json');
	const before = readFileSync(target, 'utf8');
	writeFileSync(path.join(config.dataRoot, 'overrides/keybindings.json'), 'not json');
	assert.throws(() => syncProfile(config), /invalid JSONC/);
	assert.equal(readFileSync(target, 'utf8'), before);
});

test('refuses a shared profile and unsafe managed paths', context => {
	const config = profileFixture(context);
	assert.throws(() => syncProfile({ ...config, profileRoot: path.dirname(config.officialUserRoot) }), /must be separate/);
	syncProfile(config);
	writeFileSync(path.join(config.dataRoot, 'profile-files.json'), '["../settings.json"]');
	assert.throws(() => syncProfile(config), /Invalid managed snippet path/);
});

test('release decisions never downgrade and require a verified stable commit', () => {
	const current = { version: '1.137.0', upstreamCommit: 'a'.repeat(40) };
	assert.equal(releaseDecision(current, { productVersion: '1.137.0', version: 'a'.repeat(40) }), 'current');
	assert.equal(releaseDecision(current, { productVersion: '1.137.1', version: 'b'.repeat(40) }), 'update');
	assert.equal(releaseDecision(current, { productVersion: '1.136.0', version: 'b'.repeat(40) }), 'ahead');
	assert.throws(() => releaseDecision(current, { productVersion: '1.137.0', version: 'b'.repeat(40) }), /commit differs/);
	assert.throws(() => releaseDecision(current, { productVersion: '../1.138.0', version: 'b'.repeat(40) }), /Invalid stable version/);
	assert.throws(() => releaseDecision(current, { productVersion: '1.138.0', version: 'invalid' }), /invalid source commit/);
});

test('staged releases activate only when the editor is closed and retain rollback', () => {
	const active = { version: '1.137.0' };
	const pending = { version: '1.137.1' };
	const state = { active, pending, previous: null };
	assert.equal(selectRelease(state, true), state);
	assert.deepEqual(selectRelease(state, false), { active: pending, previous: active, pending: null });
	assert.deepEqual(state, { active, pending, previous: null });
});

test('launch keeps the configured profile independent of the calling editor environment', () => {
	const parent = {
		PATH: 'unchanged', ELECTRON_RUN_AS_NODE: '1', VSCODE_APPDATA: 'another-profile',
		VSCODE_PORTABLE: 'portable-profile', vscode_extensions: 'another-extension-directory'
	};
	assert.deepEqual(launchEnvironment(parent), {
		PATH: 'unchanged', NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1'
	});
	assert.equal(parent.VSCODE_APPDATA, 'another-profile');
});

test('default launch opens an explicit empty workspace rather than disabling source-tree built-ins', context => {
	const dataRoot = fixture(context);
	const config = { dataRoot };
	const [workspace] = launchWorkspaceArguments(config, []);
	assert.deepEqual(JSON.parse(readFileSync(workspace, 'utf8')), { folders: [] });
	assert.deepEqual(launchWorkspaceArguments(config, []), [workspace]);
	assert.deepEqual(launchWorkspaceArguments(config, ['chosen-project']), ['chosen-project']);
});

test('repeated settings sync preserves authentication databases and Electron encryption state', context => {
	const config = profileFixture(context);
	const files = ['User/globalStorage/state.vscdb', 'User/globalStorage/state.vscdb.backup', 'Local State'];
	for (const relative of files) {
		const target = path.join(config.profileRoot, relative);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, `persistent fixture: ${relative}`);
	}
	syncProfile(config);
	writeFileSync(path.join(config.officialUserRoot, 'settings.json'), '{"editor.fontSize":18}');
	syncProfile(config);
	for (const relative of files) {
		assert.equal(readFileSync(path.join(config.profileRoot, relative), 'utf8'), `persistent fixture: ${relative}`);
	}
});