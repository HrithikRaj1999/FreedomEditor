import type { IDisposable } from '../common/lifecycle.js';

export interface IElementZoomController extends IDisposable {
	reset(): void;
}

export function installElementZoom(container: HTMLElement, isEnabled: () => boolean = () => true): IElementZoomController {
	const zoomedElements = new Map<HTMLElement, { value: string; priority: string; base: number; factor: number }>();
	const targetWindow = container.ownerDocument.defaultView!;
	const options = { capture: true, passive: false };

	const reset = () => {
		for (const [element, original] of zoomedElements) {
			if (original.value) {
				element.style.setProperty('zoom', original.value, original.priority);
			} else {
				element.style.removeProperty('zoom');
			}
		}
		zoomedElements.clear();
	};

	const onWheel = (event: WheelEvent) => {
		if (!isEnabled() || !event.ctrlKey || event.altKey || event.shiftKey || event.deltaY === 0) {
			return;
		}

		let target: HTMLElement | undefined;
		for (const entry of event.composedPath()) {
			if (entry === container) {
				break;
			}
			const element = entry as HTMLElement;
				if (element.nodeType === 1 && element.namespaceURI === 'http://www.w3.org/1999/xhtml') {
					if (element.matches('.monaco-editor, .monaco-list, .xterm')) {
						target = element;
						break;
					}
					if (!target && element.matches('div, section, article, main, aside, nav, form, fieldset, pre, table, ul, ol')) {
						target = element;
					}
			}
		}
		if (!target) {
			return;
		}

		event.preventDefault();
		event.stopImmediatePropagation();
		for (const element of zoomedElements.keys()) {
			if (!element.isConnected) {
				zoomedElements.delete(element);
			}
		}

		let original = zoomedElements.get(target);
		if (!original) {
			const computedZoom = targetWindow.getComputedStyle(target).zoom;
			original = {
				value: target.style.getPropertyValue('zoom'),
				priority: target.style.getPropertyPriority('zoom'),
				base: Number.parseFloat(computedZoom) || 1,
				factor: 1
			};
			zoomedElements.set(target, original);
		}

		const delta = event.deltaMode === 0 ? event.deltaY / 100 : event.deltaY;
		original.factor = Math.round(Math.max(0.5, Math.min(3, original.factor - Math.max(-1, Math.min(1, delta)) * 0.1)) * 1000) / 1000;
		if (original.factor === 1) {
			if (original.value) {
				target.style.setProperty('zoom', original.value, original.priority);
			} else {
				target.style.removeProperty('zoom');
			}
			zoomedElements.delete(target);
		} else {
			target.style.setProperty('zoom', String(original.base * original.factor), 'important');
		}
	};

	container.addEventListener('wheel', onWheel, options);
	return {
		reset,
		dispose: () => {
			container.removeEventListener('wheel', onWheel, options);
			reset();
		}
	};
}