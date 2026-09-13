/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { isWindowsNativeBinary } from '../nativeBinary.ts';

test('Windows resource patching distinguishes PE from ELF and Mach-O payloads', async context => {
	const directory = mkdtempSync(join(tmpdir(), 'freedomeditor-native-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const headers = ['4d5a9000', '7f454c46', 'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'];
	const results: boolean[] = [];
	for (const header of headers) {
		const file = join(directory, `${header}.node`);
		writeFileSync(file, Buffer.from(header, 'hex'));
		results.push(await isWindowsNativeBinary(file));
	}
	assert.deepEqual(results, [true, false, false, false, false, false, false, false, false, false]);
});

test('invalid or missing native binaries fail rather than silently skipping branding', async context => {
	const directory = mkdtempSync(join(tmpdir(), 'freedomeditor-native-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	for (const header of ['', '4d5a', '00000000']) {
		const file = join(directory, `${header || 'empty'}.node`);
		writeFileSync(file, Buffer.from(header, 'hex'));
		await assert.rejects(isWindowsNativeBinary(file), /Unrecognized or truncated native binary/);
	}
	await assert.rejects(isWindowsNativeBinary(join(directory, 'missing.node')), /ENOENT/);
});
