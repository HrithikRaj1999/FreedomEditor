import type { IDisposable } from '../common/lifecycle.js';

export interface IElementZoomController extends IDisposable {
	reset(): void;
}

export function installElementZoom(container: HTMLElement, isEnabled: () => boolean = () => true): IElementZoomController {
	const zoomedElements = new Map<HTMLElement, { value: string; priority: string; base: number; factor: number; parent: HTMLElement | null }>();
	const zoomedParents = new Map<HTMLElement, { value: string; priority: string; refCount: number }>();
	const targetWindow = container.ownerDocument.defaultView!;
	const options = { capture: true, passive: false };

	// CSS `zoom` grows the target's own box (unlike `transform: scale`), so a
	// zoomed-in fixed-layout widget (editor/list/terminal) can render taller
	// than the fixed-size ancestor that hosts it. That ancestor typically
	// clips overflow, and the widget's own virtualized scroll accounting is
	// unaware of the zoom (it measures in the widget's local, still-unzoomed
	// coordinate space), so the extra rendered content becomes permanently
	// unreachable: the internal scrollbar reports "scrolled to the end" while
	// part of the last rows/lines stay clipped below the fold. Restoring
	// native overflow scrolling on the immediate parent gives that clipped
	// content an escape hatch so it can still be scrolled into view.
	const releaseParentOverflow = (parent: HTMLElement | null) => {
		if (!parent) {
			return;
		}
		const entry = zoomedParents.get(parent);
		if (!entry) {
			return;
		}
		entry.refCount--;
		if (entry.refCount > 0) {
			return;
		}
		if (entry.value) {
			parent.style.setProperty('overflow-y', entry.value, entry.priority);
		} else {
			parent.style.removeProperty('overflow-y');
		}
		zoomedParents.delete(parent);
	};

	const claimParentOverflow = (parent: HTMLElement | null) => {
		if (!parent) {
			return;
		}
		let entry = zoomedParents.get(parent);
		if (!entry) {
			entry = {
				value: parent.style.getPropertyValue('overflow-y'),
				priority: parent.style.getPropertyPriority('overflow-y'),
				refCount: 0
			};
			zoomedParents.set(parent, entry);
		}
		entry.refCount++;
		parent.style.setProperty('overflow-y', 'auto', 'important');
	};

	const reset = () => {
		for (const [element, original] of zoomedElements) {
			if (original.value) {
				element.style.setProperty('zoom', original.value, original.priority);
			} else {
				element.style.removeProperty('zoom');
			}
			releaseParentOverflow(original.parent);
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
		for (const [element, entry] of zoomedElements) {
			if (!element.isConnected) {
				releaseParentOverflow(entry.parent);
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
				factor: 1,
				parent: target.parentElement
			};
			zoomedElements.set(target, original);
		}

		const delta = event.deltaMode === 0 ? event.deltaY / 100 : event.deltaY;
		const previousFactor = original.factor;
		original.factor = Math.round(Math.max(0.5, Math.min(3, original.factor - Math.max(-1, Math.min(1, delta)) * 0.1)) * 1000) / 1000;
		if (original.factor === 1) {
			if (original.value) {
				target.style.setProperty('zoom', original.value, original.priority);
			} else {
				target.style.removeProperty('zoom');
			}
			if (previousFactor !== 1) {
				releaseParentOverflow(original.parent);
			}
			zoomedElements.delete(target);
		} else {
			target.style.setProperty('zoom', String(original.base * original.factor), 'important');
			if (previousFactor === 1) {
				claimParentOverflow(original.parent);
			}
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