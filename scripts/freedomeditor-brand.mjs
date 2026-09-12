import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'freedomeditor/package.json'));
const { Resvg } = require('@resvg/resvg-js');
const assets = path.join(root, 'freedomeditor/assets');
const source = readFileSync(path.join(assets, 'freedomeditor.svg'), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng());
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let index = 0; index < sizes.length; index++) {
	const entry = 6 + index * 16;
	header[entry] = sizes[index] % 256;
	header[entry + 1] = sizes[index] % 256;
	header.writeUInt16LE(1, entry + 4);
	header.writeUInt16LE(32, entry + 6);
	header.writeUInt32LE(images[index].length, entry + 8);
	header.writeUInt32LE(offset, entry + 12);
	offset += images[index].length;
}
const icon = Buffer.concat([header, ...images]);
assert.equal(icon.length, offset);
assert.equal(icon.readUInt16LE(4), sizes.length);
writeFileSync(path.join(assets, 'freedomeditor.ico'), icon);
writeFileSync(path.join(assets, 'freedomeditor.png'), images.at(-1));
for (const relative of ['resources/win32/code.ico', 'resources/linux/code.png']) {
	const destination = path.join(root, relative);
	mkdirSync(path.dirname(destination), { recursive: true });
	copyFileSync(path.join(assets, relative.endsWith('.ico') ? 'freedomeditor.ico' : 'freedomeditor.png'), destination);
}
const workbenchIcon = path.join(root, 'src/vs/workbench/browser/media/code-icon.svg');
if (existsSync(workbenchIcon)) {
	copyFileSync(path.join(assets, 'freedomeditor.svg'), workbenchIcon);
}
console.log(`Generated FreedomEditor PNG and ${sizes.length}-resolution Windows icon.`);