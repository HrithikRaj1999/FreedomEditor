import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'package.json'));
const { _electron } = require('playwright-core');
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
const config = JSON.parse(readFileSync(path.join(root, '.freedomeditor/config.json'), 'utf8'));
const environment = { ...process.env, VSCODE_DEV: '1', NODE_ENV: 'development', VSCODE_CLI: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
	executablePath: path.join(root, '.build/electron/FreedomEditor.exe'),
	args: [root, workspace, path.join(workspace, 'pipeline.ts'), '--user-data-dir', profile, '--extensions-dir', config.extensionsRoot,
		'--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-extension=vscode.vscode-api-tests',
		'--disable-extension=GitHub.copilot-chat', '--disable-extension=GitHub.copilot'],
	cwd: root,
	env: environment,
	timeout: 90_000
});
try {
	const window = await app.firstWindow({ timeout: 90_000 });
	await window.locator('.monaco-workbench').waitFor({ timeout: 90_000 });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
	await window.locator('.monaco-editor .view-lines').first().waitFor({ timeout: 60_000 });
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
	await window.screenshot({ path: path.join(root, 'freedomeditor/assets/preview-graphite.png') });
	await window.keyboard.press('Control+k');
	await window.keyboard.press('Control+t');
	await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Freedom Graphite' }).first().waitFor();
	await input.fill('Freedom Paper');
	await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Freedom Paper' }).first().click();
	await window.waitForFunction(() => getComputedStyle(document.querySelector('.monaco-workbench')).getPropertyValue('--vscode-editor-background').trim().toLowerCase() === '#fafcfb');
	await window.screenshot({ path: path.join(root, 'freedomeditor/assets/preview-paper.png') });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 720));
	assert.ok(await window.locator('.monaco-editor .view-lines').first().isVisible());
	await window.screenshot({ path: path.join(runRoot, 'compact.png') });
	console.log(JSON.stringify({ result: 'passed', profile, screenshots: 'freedomeditor/assets/preview-{graphite,paper}.png', compact: path.join(runRoot, 'compact.png') }, null, 2));
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