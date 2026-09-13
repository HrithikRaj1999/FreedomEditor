import { installElementZoom, type IElementZoomController } from '../../../../base/browser/elementZoom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { getWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWebviewService } from '../../webview/browser/webview.js';

class LocalZoomContribution extends Disposable {
	static readonly ID = 'workbench.contrib.localZoom';
	private readonly controllers = new Map<HTMLElement, IElementZoomController>();

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWebviewService private readonly webviewService: IWebviewService
	) {
		super();
		for (const container of layoutService.containers) {
			this.registerContainer(container, this._store);
		}
		this._register(layoutService.onDidAddContainer(({ container, disposables }) => this.registerContainer(container, disposables)));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('workbench.localMouseWheelZoom') && !this.isEnabled()) {
				this.reset();
			}
		}));
	}

	private isEnabled(): boolean {
		return this.configurationService.getValue<boolean>('workbench.localMouseWheelZoom') !== false;
	}

	private registerContainer(container: HTMLElement, disposables: DisposableStore): void {
		const controller = disposables.add(installElementZoom(container, () => this.isEnabled()));
		this.controllers.set(container, controller);
		disposables.add(toDisposable(() => this.controllers.delete(container)));
	}

	reset(): void {
		for (const controller of this.controllers.values()) {
			controller.reset();
		}
		for (const webview of this.webviewService.webviews) {
			webview.resetLocalZoom();
		}
	}
}

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'workbench',
	properties: {
		'workbench.localMouseWheelZoom': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('localMouseWheelZoom', "Zoom the local container under the pointer with Ctrl+mouse wheel, without zooming the rest of the window.")
		}
	}
});

registerWorkbenchContribution2(LocalZoomContribution.ID, LocalZoomContribution, WorkbenchPhase.BlockRestore);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.resetLocalZoom',
			title: localize2('resetLocalZoom', "Reset Local Zoom"),
			category: localize2('freedomEditor', "FreedomEditor"),
			f1: true
		});
	}

	run(): void {
		getWorkbenchContribution<LocalZoomContribution>(LocalZoomContribution.ID).reset();
	}
});