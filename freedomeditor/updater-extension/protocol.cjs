/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const path = require('node:path');
const { createHash } = require('node:crypto');

function updateGateName(installRoot) {
	const key = createHash('sha256').update(path.resolve(installRoot).toLowerCase()).digest('hex').slice(0, 32);
	return `Global\\FreedomEditorUpdate-${key}`;
}

function configurationPath(environment = process.env) {
	if (!environment.LOCALAPPDATA) {
		throw new Error('LOCALAPPDATA is required to configure FreedomEditor updates.');
	}
	return path.join(environment.LOCALAPPDATA, 'FreedomEditor', 'updates', 'config.json');
}

function updatePaths(configPath) {
	const directory = path.dirname(configPath);
	return {
		directory,
		state: path.join(directory, 'state.json'),
		log: path.join(directory, 'update.log'),
		receipt: path.join(directory, 'installation.json'),
		packages: path.join(directory, 'packages')
	};
}

function validateConfiguration(config) {
	if (!config || config.schemaVersion !== 1 || typeof config.enabled !== 'boolean' || config.channel !== 'stable') {
		throw new Error('Invalid FreedomEditor update configuration.');
	}
	for (const key of ['sourceRoot', 'installRoot', 'nodePath', 'signToolPath', 'buildRoot']) {
		if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) {
			throw new Error(`The update configuration requires an absolute ${key}.`);
		}
	}
	if (typeof config.sourceRef !== 'string' || !config.sourceRef.startsWith('refs/heads/') || !/^[a-f0-9]{40}$/i.test(config.upstreamBase ?? '')) {
		throw new Error('Updates require a local customization branch and a pinned official upstream base.');
	}
	if (config.gateMutexName !== updateGateName(config.installRoot)) {
		throw new Error('The update launch gate does not match the configured installation.');
	}
	return config;
}

function workerEnvironment(parent = process.env) {
	const environment = { ...parent };
	for (const key of Object.keys(environment)) {
		if (/^(VSCODE_.*|ELECTRON_RUN_AS_NODE|PSMODULEPATH|GH_TOKEN|GITHUB_TOKEN|COPILOT_GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+))$/i.test(key)) {
			delete environment[key];
		}
	}
	return environment;
}

function workerInvocation(config, action, configPath) {
	validateConfiguration(config);
	if (!['update', 'check', 'pause', 'resume'].includes(action)) {
		throw new Error(`Unsupported update action: ${action}`);
	}
	return {
		executable: config.nodePath,
		args: [path.join(config.sourceRoot, 'scripts', 'freedomeditor-auto-update.mjs'), action, '--config', configPath],
		cwd: config.sourceRoot
	};
}

module.exports = { configurationPath, updatePaths, updateGateName, validateConfiguration, workerEnvironment, workerInvocation };
