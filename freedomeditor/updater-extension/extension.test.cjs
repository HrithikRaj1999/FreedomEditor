/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const protocol = require('./protocol.cjs');

const config = {
	schemaVersion: 1, enabled: true, channel: 'stable',
	sourceRoot: path.resolve('source'), sourceRef: 'refs/heads/customizations',
	upstreamBase: 'a'.repeat(40), installRoot: path.resolve('installed'),
	nodePath: path.resolve('node.exe'), signToolPath: path.resolve('signtool.exe'),
	buildRoot: path.resolve('source', '.build')
};
config.gateMutexName = protocol.updateGateName(config.installRoot);

test('updater configuration cannot select arbitrary channels, relative executables, or non-branch refs', () => {
	assert.equal(protocol.validateConfiguration(config), config);
	for (const invalid of [
		{ ...config, channel: 'insider' }, { ...config, nodePath: 'node.exe' },
		{ ...config, sourceRef: 'https://untrusted.example/main' }, { ...config, upstreamBase: 'invalid' }
	]) {
		assert.throws(() => protocol.validateConfiguration(invalid));
	}
});

test('background workers do not inherit development/profile overrides or CLI authentication', () => {
	const parent = {
		PATH: 'kept', VSCODE_DEV: '1', vscode_portable: 'elsewhere', ELECTRON_RUN_AS_NODE: '1',
		GITHUB_TOKEN: 'fixture', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'fixture', GIT_CONFIG_VALUE_0: 'fixture'
	};
	parent.PSModulePath = 'incompatible parent PowerShell modules';
	assert.deepEqual(protocol.workerEnvironment(parent), { PATH: 'kept' });
	assert.equal(parent.GITHUB_TOKEN, 'fixture');
	assert.throws(() => protocol.workerInvocation(config, 'unrecognized-command', path.resolve('config.json')));
});

function activate(context, settings = config, appRoot = path.join(config.installRoot, 'resources', 'app')) {
	const configPath = path.resolve('updates', 'config.json');
	const files = new Map(settings ? [[configPath, JSON.stringify(settings)]] : []);
	const commands = new Map();
	const spawned = [];
	const messages = [];
	const output = { appendLine: text => messages.push(text), show() {}, dispose() {} };
	const watcher = new EventEmitter();
	watcher.close = () => { watcher.closed = true; };
	const fakeFs = {
		existsSync: file => files.has(file),
		readFileSync: file => files.get(file),
		mkdirSync() {}, openSync: () => 42, closeSync() {},
		watch: () => watcher
	};
	const vscode = {
		env: { appRoot },
		l10n: { t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, index) => String(args[index])) },
		window: { createOutputChannel: () => output, showInformationMessage: text => messages.push(text), showWarningMessage: text => messages.push(text) },
		workspace: { getConfiguration() { throw new Error('Workspace configuration must not control the updater.'); } },
		commands: { registerCommand: (id, handler) => { commands.set(id, handler); return { dispose() {} }; } }
	};
	const modules = {
		'node:fs': fakeFs, 'node:path': path, vscode,
		'node:child_process': {
			spawn: (executable, args, options) => {
				const child = new EventEmitter();
				child.unref = () => {};
				spawned.push({ executable, args, options, child });
				return child;
			}
		},
		'./protocol.cjs': { ...protocol, configurationPath: () => configPath }
	};
	const sandbox = {
		require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; },
		module: { exports: {} }, process: { platform: 'win32' }, setTimeout, clearTimeout
	};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'extension.cjs'), 'utf8'), sandbox);
	const extensionContext = { subscriptions: [], globalState: { get() {}, async update() {} } };
	sandbox.module.exports.activate(extensionContext);
	context.after(() => extensionContext.subscriptions.forEach(disposable => disposable.dispose()));
	return { spawned, commands, messages, watcher, extensionContext };
}

test('opening the configured installed application starts a detached, hidden update worker', context => {
	const h = activate(context);
	assert.equal(h.spawned.length, 1);
	assert.equal(h.spawned[0].executable, config.nodePath);
	assert.equal(h.spawned[0].args[1], 'update');
	assert.equal(h.spawned[0].options.detached, true);
	assert.equal(h.spawned[0].options.windowsHide, true);
	assert.equal(h.commands.size, 4);
});

test('unconfigured, paused, and unrelated editor instances do not start automatic updates', context => {
	assert.equal(activate(context, null).spawned.length, 0);
	assert.equal(activate(context, { ...config, enabled: false }).spawned.length, 0);
	assert.equal(activate(context, config, path.resolve('another-app', 'resources', 'app')).spawned.length, 0);
});

test('manual check and pause commands use only the trusted machine configuration', context => {
	const h = activate(context, { ...config, enabled: false });
	h.commands.get('freedomeditor.checkForUpdates')();
	h.commands.get('freedomeditor.pauseUpdates')();
	assert.deepEqual(h.spawned.map(child => child.args[1]), ['check', 'pause']);
});

test('invalid configuration and a failed worker are surfaced rather than reported as success', context => {
	const invalid = activate(context, { ...config, nodePath: 'relative.exe' });
	assert.equal(invalid.spawned.length, 0);
	assert.ok(invalid.messages.some(message => message.includes('need attention')));
	const h = activate(context);
	h.spawned[0].child.emit('exit', 1);
	assert.ok(h.messages.some(message => message.includes('exit code 1')));
});
