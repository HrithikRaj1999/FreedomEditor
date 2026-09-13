import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launchEnvironment } from './freedomeditor-sync.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'package.json'));
const { _electron } = require('playwright-core');
const { values } = parseArgs({
	options: {
		'local-zoom': { type: 'boolean', default: false },
		executable: { type: 'string' },
		'extensions-dir': { type: 'string' }
	}
});
const localZoomMode = values['local-zoom'];
const packaged = !!values.executable;
assert.ok(!packaged || !localZoomMode, 'The internal webview local-zoom fixture requires an unbundled development build.');
const runs = path.join(root, '.freedomeditor', 'smoke');
mkdirSync(runs, { recursive: true });
const runRoot = mkdtempSync(path.join(runs, 'desktop-'));
const workspace = path.join(runRoot, 'workspace');
const profile = path.join(runRoot, 'profile');
mkdirSync(workspace);
mkdirSync(path.join(profile, 'User'), { recursive: true });
writeFileSync(path.join(workspace, 'pipeline.ts'), [
	'export interface BuildResult {',
	'  project: string;',
	'  duration: number;',
	'  status: "passed" | "failed";',
	'}',
	'',
	'export async function buildWorkspace(projects: string[]): Promise<BuildResult[]> {',
	'  return Promise.all(projects.map(async project => {',
	'    const started = performance.now();',
	'    await validateProject(project);',
	'    return { project, duration: performance.now() - started, status: "passed" };',
	'  }));',
	'}',
	'',
	'async function validateProject(project: string): Promise<void> {',
	'  if (!project.trim()) {',
	'    throw new Error("A project name is required");',
	'  }',
	'}',
	''
].join('\n'));
writeFileSync(path.join(workspace, 'analysis.py'), 'from dataclasses import dataclass\n\n\n@dataclass\nclass BuildSummary:\n    project: str\n    duration: float\n    passed: bool = True\n');
writeFileSync(path.join(workspace, 'architecture.mmd'), 'flowchart LR\n    Source --> Validate\n    Validate --> Build\n    Build --> Release\n');
writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
	'workbench.colorTheme': 'Freedom Graphite',
	'window.autoDetectColorScheme': false,
	'workbench.startupEditor': 'none',
	'workbench.editor.enablePreview': false,
	'git.openRepositoryInParentFolders': 'never',
	'extensions.autoCheckUpdates': false,
	'extensions.autoUpdate': false,
	'telemetry.telemetryLevel': 'off',
	'chat.disableAIFeatures': true
}, null, '\t'));
const configPath = path.join(root, '.freedomeditor', 'config.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const extensions = values['extensions-dir'] ?? config.extensionsRoot ?? path.join(runRoot, 'extensions');
const environment = launchEnvironment();
for (const key of Object.keys(environment)) {
	if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/i.test(key)) {
		delete environment[key];
	}
}
if (packaged) {
	delete environment.VSCODE_DEV;
	environment.NODE_ENV = 'production';
}
const app = await _electron.launch({
	executablePath: values.executable ?? path.join(root, '.build', 'electron', 'FreedomEditor.exe'),
	args: [...(packaged ? [] : [root]), workspace, path.join(workspace, 'pipeline.ts'), '--user-data-dir', profile, '--extensions-dir', extensions,
		'--shared-data-dir', path.join(runRoot, 'shared-data'),
		'--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-extension=vscode.vscode-api-tests',
		'--disable-extension=GitHub.copilot-chat', '--disable-extension=GitHub.copilot'],
	cwd: root,
	env: environment,
	timeout: 90_000
});
try {
	if (packaged) {
		const identity = await app.evaluate(({ app }) => ({
			name: app.getName(), packaged: app.isPackaged, profile: app.getPath('userData')
		}));
		assert.deepEqual(identity, { name: 'FreedomEditor', packaged: true, profile });
	}
	const window = await app.firstWindow({ timeout: 90_000 });
	await window.locator('.monaco-workbench').waitFor({ timeout: 90_000 });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
	await window.locator('.monaco-editor .view-lines').first().waitFor({ timeout: 60_000 });
	if (localZoomMode) {
		await testLocalZoom(window);
	} else {
	await window.locator('[aria-label="Customize FreedomEditor"]').first().waitFor({ timeout: 90_000 });
	await window.keyboard.press('Control+Shift+P');
	const input = window.locator('.quick-input-widget .quick-input-box input');
	await input.fill('>FreedomEditor: Customize Editor');
	await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Customize Editor' }).first().waitFor({ timeout: 30_000 });
	await window.keyboard.press('Enter');
	await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Color Theme' }).first().waitFor();
	await window.screenshot({ path: path.join(runRoot, 'customization.png') });
	await window.keyboard.press('Escape');
	const graphite = await window.locator('.monaco-workbench').evaluate(element => getComputedStyle(element).getPropertyValue('--vscode-editor-background').trim());
	assert.equal(graphite.toLowerCase(), '#1c2021');
	await window.screenshot({ path: path.join(runRoot, 'preview-graphite.png') });
	await window.keyboard.press('Control+k');
	await window.keyboard.press('Control+t');
	await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Freedom Graphite' }).first().waitFor();
	await input.fill('Freedom Paper');
	await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Freedom Paper' }).first().click();
	await window.waitForFunction(() => getComputedStyle(document.querySelector('.monaco-workbench')).getPropertyValue('--vscode-editor-background').trim().toLowerCase() === '#fafcfb');
	await window.screenshot({ path: path.join(runRoot, 'preview-paper.png') });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 720));
	assert.ok(await window.locator('.monaco-editor .view-lines').first().isVisible());
	await window.screenshot({ path: path.join(runRoot, 'compact.png') });
	console.log(JSON.stringify({ result: 'passed', profile, screenshots: runRoot, packaged }, null, 2));
	}
} catch (error) {
	const window = app.windows()[0];
	if (window) {
		await window.screenshot({ path: path.join(runRoot, 'failure.png') });
		writeFileSync(path.join(runRoot, 'failure.txt'), await window.locator('body').innerText());
	}
	console.error(`Smoke-test evidence: ${runRoot}`);
	throw error;
} finally {
	await app.close();
}

async function testLocalZoom(window) {
	const runCommand = async title => {
		await window.keyboard.press('Escape');
		await window.keyboard.press('Control+Shift+P');
		await window.locator('.quick-input-widget .quick-input-box input').fill(`>${title}`);
		await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: title }).first().click({ timeout: 60_000 });
	};
	const zoom = async locator => {
		await locator.scrollIntoViewIfNeeded();
		const bounds = await locator.boundingBox();
		assert.ok(bounds);
		await window.mouse.move(bounds.x + Math.min(16, bounds.width / 2), bounds.y + Math.min(16, bounds.height / 2));
		await window.keyboard.down('Control');
		try {
			await window.mouse.wheel(0, -100);
		} finally {
			await window.keyboard.up('Control');
		}
	};

	const editorLine = window.locator('.monaco-editor .view-line').first();
	await zoom(editorLine);
	const zoomedEditor = window.locator('.monaco-editor[style*="zoom: 1.1"]').first();
	await zoomedEditor.waitFor({ timeout: 10_000 });
	assert.equal(await editorLine.evaluate(element => element.style.zoom), '');
	await editorLine.click({ position: { x: 60, y: 10 } });
	await window.keyboard.press('End');
	await window.keyboard.type(' ');
	await window.keyboard.press('Control+z');
	await runCommand('FreedomEditor: Reset Local Zoom');
	await zoomedEditor.waitFor({ state: 'hidden', timeout: 10_000 });
	const explorerRow = window.locator('.explorer-folders-view .monaco-list-row:visible').first();
	await zoom(explorerRow);
	const zoomedList = window.locator('.explorer-folders-view .monaco-list[style*="zoom: 1.1"]').first();
	await zoomedList.waitFor({ timeout: 10_000 });
	assert.equal(await explorerRow.evaluate(element => element.style.zoom), '');
	await runCommand('FreedomEditor: Reset Local Zoom');
	await zoomedList.waitFor({ state: 'hidden', timeout: 10_000 });

	await window.keyboard.press('Control+,');
	const setting = window.locator('.settings-editor .setting-item-label:visible').first();
	await setting.waitFor({ timeout: 30_000 });
	await zoom(setting);
	const zoomedSetting = window.locator('.settings-editor [style*="zoom: 1.1"]').first();
	await zoomedSetting.waitFor({ timeout: 10_000 });
	const settingHandle = await zoomedSetting.elementHandle();
	assert.equal(await window.locator('.monaco-workbench').evaluate(element => element.style.zoom), '');
	assert.equal(await window.locator('.part.sidebar').evaluate(element => element.style.zoom), '');
	await window.screenshot({ path: path.join(runRoot, 'zoom-settings-wide.png') });
	await runCommand('FreedomEditor: Reset Local Zoom');
	assert.equal(await settingHandle.evaluate(element => element.style.zoom), '');
	await settingHandle.dispose();

	const fixture = await window.evaluateHandle(async () => {
		const { getWorkbenchContribution } = await import(new URL('../../../workbench/common/contributions.js', location.href).href);
		const contribution = getWorkbenchContribution('workbench.contrib.localZoom');
		const enabled = contribution.configurationService.getValue('workbench.localMouseWheelZoom');
		const host = document.createElement('section');
		host.style.cssText = 'position:absolute;inset:120px 32px 80px 340px;z-index:500;background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border)';
		document.querySelector('.monaco-workbench').append(host);
		const webview = contribution.webviewService.createWebviewElement({
			title: 'Local Zoom Smoke', options: {},
			contentOptions: { allowScripts: false, allowForms: true }, extension: undefined
		});
		webview.mountTo(host, window);
		webview.setHtml(`<!DOCTYPE html><html data-zoom-default="${enabled}"><head>
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
			<style>body{padding:16px;font:16px/1.5 sans-serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:24px}.box{border:1px solid currentColor;padding:12px}input{font:inherit;max-width:100%;box-sizing:border-box}</style>
			</head><body><main><div class="box" id="zoom-first"><p><span>First section</span></p><p>All text in this section</p><input aria-label="Editable text" value="Editable text"></div><div class="box" id="zoom-second"><p>Second section</p><p>Independent text</p></div></main></body></html>`);
		return { webview, host, configurationService: contribution.configurationService };
	});
	try {
	const content = window.frameLocator('iframe.webview').frameLocator('#active-frame');
	const first = content.locator('#zoom-first');
	const second = content.locator('#zoom-second');
	await first.waitFor({ timeout: 30_000 });
	assert.equal(await content.locator('html').getAttribute('data-zoom-default'), 'true');
	const textBounds = async locator => locator.evaluate(element => {
		const range = document.createRange();
		range.selectNodeContents(element);
		const bounds = range.getBoundingClientRect();
		return { width: bounds.width, height: bounds.height };
	});
	const siblingBefore = await textBounds(second.locator('p').first());
	const textBefore = await textBounds(first.locator('p').first());
	await zoom(first);
	await content.locator('#zoom-first[style*="zoom: 1.1"]').waitFor({ timeout: 10_000 });
	const siblingAfter = await textBounds(second.locator('p').first());
	const textAfter = await textBounds(first.locator('p').first());
	assert.equal(await second.evaluate(element => element.style.zoom), '');
	assert.deepEqual(siblingAfter, siblingBefore);
	assert.ok(textAfter.height > textBefore.height * 1.05);
	await content.getByRole('textbox', { name: 'Editable text' }).click();
	await content.getByRole('textbox', { name: 'Editable text' }).fill('Editing still works');
	assert.equal(await content.getByRole('textbox', { name: 'Editable text' }).inputValue(), 'Editing still works');
	await window.screenshot({ path: path.join(runRoot, 'zoom-webview-wide.png') });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 720));
	assert.ok(await first.isVisible());
	assert.ok(await second.isVisible());
	await window.screenshot({ path: path.join(runRoot, 'zoom-webview-compact.png') });
	await runCommand('FreedomEditor: Reset Local Zoom');
	await content.locator('#zoom-first:not([style*="zoom"])').waitFor({ timeout: 10_000 });
	await zoom(first);
	await content.locator('#zoom-first[style*="zoom: 1.1"]').waitFor({ timeout: 10_000 });
	await fixture.evaluate(({ configurationService }) => configurationService.updateValue('workbench.localMouseWheelZoom', false));
	await content.locator('#zoom-first:not([style*="zoom"])').waitFor({ timeout: 10_000 });
	await zoom(first);
	assert.equal(await first.evaluate(element => element.style.zoom), '');
	console.log(JSON.stringify({ result: 'passed', mode: 'local-zoom', checks: ['default enabled', 'code editor', 'Explorer list', 'Settings', 'webview with service worker', 'sibling isolation', 'editable inputs', 'reset', 'disable setting', 'wide and compact windows'], screenshots: runRoot }, null, 2));
	} finally {
		await fixture.evaluate(({ webview, host }) => {
			webview.dispose();
			host.remove();
		});
		await fixture.dispose();
	}
}