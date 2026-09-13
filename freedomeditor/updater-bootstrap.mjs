/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app } from 'electron';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import protocol from './updater-extension/protocol.cjs';

let updating = false;
if (process.platform === 'win32') {
	// Use the existing native binding before VS Code installs its ASAR module-resolution hooks.
	const require = createRequire(import.meta.url);
	const mutex = require('../node_modules.asar/@vscode/windows-mutex/build/Release/CreateMutex.node');
	updating = mutex.isActive(protocol.updateGateName(realpathSync(path.dirname(process.execPath))));
}

if (updating) {
	console.error('FreedomEditor is installing an update. Open it again after installation finishes.');
	app.exit(0);
} else {
	await import('../out/main.js');
}
