const vscode = require('vscode');

async function chooseLayout() {
	const layouts = [
		{ label: '$(layout-sidebar-right) Agent Sidebar', command: 'workbench.action.toggleAuxiliaryBar' },
		{ label: '$(layout) Single Editor', command: 'workbench.action.editorLayoutSingle' },
		{ label: '$(split-horizontal) Two Columns', command: 'workbench.action.editorLayoutTwoColumns' },
		{ label: '$(split-vertical) Two Rows', command: 'workbench.action.editorLayoutTwoRows' },
		{ label: '$(screen-full) Zen Mode', command: 'workbench.action.toggleZenMode' },
		{ label: '$(layout-centered) Centered Editor', command: 'workbench.action.toggleCenteredLayout' }
	];
	const selected = await vscode.window.showQuickPick(layouts, { title: 'FreedomEditor: Coding Layout', placeHolder: 'Layout' });
	if (selected) {
		await vscode.commands.executeCommand(selected.command);
	}
}

async function customize() {
	const choices = [
		{ label: '$(color-mode) Color Theme', command: 'workbench.action.selectTheme' },
		{ label: '$(symbol-file) File Icons', command: 'workbench.action.selectIconTheme' },
		{ label: '$(layout) Coding Layout', command: 'freedomeditor.layout' },
		{ label: '$(text-size) Editor Font', command: 'workbench.action.openSettings', argument: 'editor.font' },
		{ label: '$(keyboard) Keyboard Shortcuts', command: 'workbench.action.openGlobalKeybindings' },
		{ label: '$(symbol-snippet) User Snippets', command: 'workbench.action.openSnippets' },
		{ label: '$(extensions) Extensions', command: 'workbench.view.extensions' },
		{ label: '$(settings-gear) All Settings', command: 'workbench.action.openSettings' },
		{ label: '$(cloud-download) Releases', command: 'freedomeditor.updates' }
	];
	const selected = await vscode.window.showQuickPick(choices, { title: 'FreedomEditor: Customize', placeHolder: 'Customize' });
	if (selected) {
		await vscode.commands.executeCommand(selected.command, ...(selected.argument ? [selected.argument] : []));
	}
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand('freedomeditor.customize', customize),
		vscode.commands.registerCommand('freedomeditor.layout', chooseLayout),
		vscode.commands.registerCommand('freedomeditor.updates', () => vscode.env.openExternal(vscode.Uri.parse('https://github.com/hrithikraj1999/FreedomEditor/releases')))
	);
	const appearance = vscode.window.createStatusBarItem('freedomeditor.customize', vscode.StatusBarAlignment.Right, -100);
	appearance.name = 'FreedomEditor Customization';
	appearance.text = '$(settings-gear)';
	appearance.tooltip = 'Customize FreedomEditor';
	appearance.accessibilityInformation = { label: 'Customize FreedomEditor' };
	appearance.command = 'freedomeditor.customize';
	context.subscriptions.push(appearance);
	appearance.show();
}

module.exports = { activate };