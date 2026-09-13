/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { open } from 'fs/promises';

// ELF and Mach-O headers, including both byte orders and universal binaries.
const nonWindowsHeaders = new Set([
	0x7f454c46, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
	0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca
]);

export async function isWindowsNativeBinary(filePath: string): Promise<boolean> {
	const file = await open(filePath, 'r');
	try {
		const header = Buffer.alloc(4);
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		if (bytesRead === header.length) {
			if (header.readUInt16BE(0) === 0x4d5a) {
				return true;
			}
			if (nonWindowsHeaders.has(header.readUInt32BE(0))) {
				return false;
			}
		}
		throw new Error(`Unrecognized or truncated native binary: ${filePath}`);
	} finally {
		await file.close();
	}
}
