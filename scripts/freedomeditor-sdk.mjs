/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const patch = path.join(root, 'freedomeditor', 'patches', 'gulp-electron-signtool.patch');
const options = {
	cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000,
	input: readFileSync(patch, 'utf8').replaceAll('\r\n', '\n')
};
const reverse = spawnSync('git', ['apply', '--reverse', '--check', '-'], options);
if (reverse.error) {
	throw reverse.error;
}
if (reverse.status !== 0) {
	const result = spawnSync('git', ['apply', '-'], options);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`Cannot prepare gulp-electron SDK discovery; the dependency patch may need updating.\n${result.stderr}`);
	}
}
console.log('Windows Electron packaging supports SIGNTOOL_PATH.');
