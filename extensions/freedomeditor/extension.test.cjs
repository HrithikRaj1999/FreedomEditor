const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('all theme contributions have valid colors and usable contrast', () => {
	const manifest = require('./package.json');
	for (const theme of manifest.contributes.themes) {
		const contents = JSON.parse(fs.readFileSync(path.join(__dirname, theme.path), 'utf8'));
		assert.equal(contents.name, theme.label);
		assert.equal(contents.semanticHighlighting, true);
		for (const color of Object.values(contents.colors)) {
			assert.match(color, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
		}
		const luminance = color => {
			const channels = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
			return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
		};
		for (const prefix of ['editor', 'button', 'statusBar']) {
			const values = [luminance(contents.colors[`${prefix}.foreground`]), luminance(contents.colors[`${prefix}.background`])].sort((left, right) => right - left);
			assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${theme.label}: ${prefix} contrast`);
		}
	}
});

test('customization uses native commands and registers disposables', async () => {
	const registered = new Map();
	const executed = [];
	const status = { show() {}, dispose() {} };
	let selection = 'Color Theme';
	const vscode = {
		commands: {
			registerCommand: (name, handler) => { registered.set(name, handler); return { dispose() {} }; },
			executeCommand: (...args) => { executed.push(args); }
		},
		window: {
			createStatusBarItem: () => status,
			showQuickPick: choices => choices.find(choice => choice.label.endsWith(selection))
		},
		StatusBarAlignment: { Right: 2 },
		env: { openExternal() {} },
		Uri: { parse: value => value }
	};
	const sandbox = { require: name => { assert.equal(name, 'vscode'); return vscode; }, module: { exports: {} } };
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'extension.cjs'), 'utf8'), sandbox);
	const context = { subscriptions: [] };
	sandbox.module.exports.activate(context);
	await registered.get('freedomeditor.customize')();
	selection = 'Two Columns';
	await registered.get('freedomeditor.layout')();
	selection = 'cancel';
	await registered.get('freedomeditor.customize')();
	assert.deepEqual(executed, [['workbench.action.selectTheme'], ['workbench.action.editorLayoutTwoColumns']]);
	assert.equal(context.subscriptions.length, 4);
	assert.equal(status.command, 'freedomeditor.customize');
});