import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

export async function brandElectron(sourceRoot = root) {
	if (process.platform !== 'win32') {
		return;
	}
	const require = createRequire(path.join(sourceRoot, 'package.json'));
	const electronRequire = createRequire(require.resolve('@vscode/gulp-electron'));
	const rcedit = electronRequire('rcedit');
	const product = JSON.parse(readFileSync(path.join(sourceRoot, 'product.json'), 'utf8'));
	const { version } = JSON.parse(readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
	const executable = path.join(sourceRoot, '.build', 'electron', `${product.nameShort}.exe`);
	await rcedit(executable, {
		'version-string': {
			FileDescription: product.nameLong,
			ProductName: product.nameLong,
			CompanyName: 'FreedomEditor Community',
			InternalName: product.applicationName,
			OriginalFilename: `${product.nameShort}.exe`
		},
		'file-version': version,
		'product-version': version,
		icon: path.join(sourceRoot, 'resources', 'win32', 'code.ico')
	});
	console.log(`Branded ${executable} (${version}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	brandElectron().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}
