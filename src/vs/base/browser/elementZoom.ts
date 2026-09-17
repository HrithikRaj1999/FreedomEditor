/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../common/lifecycle.js';

export interface IElementZoomController extends IDisposable {
	reset(): void;
}

/**
 * Widgets that lay themselves out manually register themselves here, keyed by
 * the DOM node local zoom can target, so that changing that node's CSS `zoom`
 * outside of their normal `layout()` call path can ask them to re-measure and
 * relayout.
 *
 * `zoom` scales an element's rendered box *without* changing the box its own
 * parent reserved for it, so a fixed-layout widget (list, editor, ...) that
 * keeps sizing itself in outer, on-screen pixels ends up rendering larger than
 * the ancestor that hosts it and gets clipped: its scrollbars, its overlay
 * widgets (such as the editor find widget) and its caret can all end up
 * painted outside the visible area with no way to reach them. Widgets avoid
 * that by converting the sizes they are given into their own *local*
 * (zoom-compensated) coordinate space - see {@link getElementZoomFactor} - and
 * by relaying out through this registry whenever the zoom factor changes.
 *
 * NOTE: this module is also served standalone to webviews (see
 * `webviewProtocolProvider.ts`, which maps `/elementZoom.js` to this file and
 * nothing else), so it must not take any runtime imports on other modules.
 */
export const zoomRelayoutRegistry = new WeakMap<HTMLElement, () => void>();

/**
 * The CSS `zoom` factor applied to `element` itself, ignoring any zoom
 * inherited from its ancestors.
 *
 * Self-measuring geometry APIs (`offsetWidth`/`offsetHeight`,
 * `clientWidth`/`clientHeight`, `ResizeObserver`'s `contentRect`) already
 * report values in the element's local, zoom-compensated coordinate space,
 * while sizes computed by an owner living outside the zoomed element are in
 * outer, on-screen pixels. Dividing the latter by this factor converts them
 * into the same local space.
 */
export function getElementZoomFactor(element: HTMLElement | null | undefined): number {
	if (!element) {
		return 1;
	}
	const targetWindow = element.ownerDocument.defaultView;
	if (!targetWindow) {
		return 1;
	}
	const zoom = Number.parseFloat(targetWindow.getComputedStyle(element).zoom);
	return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
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
			zoomRelayoutRegistry.get(element)?.();
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
		// Widgets that manage their own layout need to know their
		// zoom-compensated content box changed so they can relayout; see the
		// registry's doc comment above for the full rationale.
		zoomRelayoutRegistry.get(target)?.();
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