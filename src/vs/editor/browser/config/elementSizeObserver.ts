/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IDimension } from '../../common/core/2d/dimension.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { getWindow, scheduleAtNextAnimationFrame } from '../../../base/browser/dom.js';
import { getElementZoomFactor } from '../../../base/browser/elementZoom.js';

export class ElementSizeObserver extends Disposable {

	private _onDidChange = this._register(new Emitter<void>());
	public readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _referenceDomElement: HTMLElement | null;
	private _width: number;
	private _height: number;
	private _resizeObserver: ResizeObserver | null;
	/**
	 * The element that local zoom (`vs/base/browser/elementZoom.ts`) can apply a
	 * CSS `zoom` to, when it is not the observed reference element itself. For
	 * the code editor this is the `.monaco-editor` node, which lives *inside*
	 * the observed container. See {@link _localZoomFactor}.
	 */
	private _zoomDomElement: HTMLElement | null = null;
	/**
	 * The most recent sizing input, replayed whenever the local zoom factor
	 * changes so that switching zoom levels never silently changes *how* the
	 * widget is sized (explicitly by its owner vs. measured from the container).
	 */
	private _lastDimension: IDimension | undefined;

	constructor(referenceDomElement: HTMLElement | null, dimension: IDimension | undefined) {
		super();
		this._referenceDomElement = referenceDomElement;
		this._width = -1;
		this._height = -1;
		this._resizeObserver = null;
		this._lastDimension = dimension;
		this.measureReferenceDomElement(false, dimension);
	}

	/**
	 * Point the observer at the element that carries a local CSS `zoom`, so the
	 * sizes it reports are expressed in that element's own coordinate space.
	 */
	public setZoomDomElement(zoomDomElement: HTMLElement | null): void {
		if (this._zoomDomElement === zoomDomElement) {
			return;
		}
		const previousZoom = this._localZoomFactor();
		this._zoomDomElement = zoomDomElement;
		if (this._localZoomFactor() !== previousZoom) {
			this.remeasure();
		}
	}

	/**
	 * Re-apply the last observed sizing. Used when the local zoom factor changed
	 * but the sizing input itself did not.
	 */
	public remeasure(): void {
		if (this._store.isDisposed) {
			return;
		}
		this.measureReferenceDomElement(true, this._lastDimension);
	}

	/**
	 * Local zoom scales how large the observed widget *renders* without changing
	 * the box its ancestor reserved for it. Everything we measure here — the
	 * container's `clientWidth`/`clientHeight`, a `ResizeObserver` content rect,
	 * or an explicit dimension computed by the widget's owner — is expressed in
	 * that unchanged outer box. Feeding those numbers straight into the editor's
	 * layout would make it lay out as if it had the full outer box available
	 * while actually painting `zoom` times larger, so everything anchored to its
	 * right/bottom edge (the vertical scrollbar, the minimap, the find widget)
	 * and any caret past the fold would be rendered outside the visible area and
	 * become unreachable. Dividing by the zoom factor converts them into the
	 * zoomed element's local space, which makes its rendered footprint match the
	 * outer box exactly again.
	 */
	private _localZoomFactor(): number {
		return getElementZoomFactor(this._zoomDomElement);
	}

	public override dispose(): void {
		this.stopObserving();
		super.dispose();
	}

	public getWidth(): number {
		return this._width;
	}

	public getHeight(): number {
		return this._height;
	}

	public startObserving(): void {
		if (!this._resizeObserver && this._referenceDomElement) {
			// We want to react to the resize observer only once per animation frame
			// The first time the resize observer fires, we will react to it immediately.
			// Otherwise we will postpone to the next animation frame.
			// We'll use `observeContentRect` to store the content rect we received.

			let observedDimension: IDimension | null = null;
			const observeNow = () => {
				if (observedDimension) {
					this.observe({ width: observedDimension.width, height: observedDimension.height });
				} else {
					this.observe();
				}
			};

			let shouldObserve = false;
			let alreadyObservedThisAnimationFrame = false;

			const update = () => {
				if (shouldObserve && !alreadyObservedThisAnimationFrame) {
					try {
						shouldObserve = false;
						alreadyObservedThisAnimationFrame = true;
						observeNow();
					} finally {
						scheduleAtNextAnimationFrame(getWindow(this._referenceDomElement), () => {
							alreadyObservedThisAnimationFrame = false;
							update();
						});
					}
				}
			};

			this._resizeObserver = new ResizeObserver((entries) => {
				if (entries && entries[0] && entries[0].contentRect) {
					observedDimension = { width: entries[0].contentRect.width, height: entries[0].contentRect.height };
				} else {
					observedDimension = null;
				}
				shouldObserve = true;
				update();
			});
			this._resizeObserver.observe(this._referenceDomElement);
		}
	}

	public stopObserving(): void {
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
	}

	public observe(dimension?: IDimension): void {
		this._lastDimension = dimension;
		this.measureReferenceDomElement(true, dimension);
	}

	private measureReferenceDomElement(emitEvent: boolean, dimension?: IDimension): void {
		let observedWidth = 0;
		let observedHeight = 0;
		if (dimension) {
			observedWidth = dimension.width;
			observedHeight = dimension.height;
		} else if (this._referenceDomElement) {
			observedWidth = this._referenceDomElement.clientWidth;
			observedHeight = this._referenceDomElement.clientHeight;
		}
		const zoom = this._localZoomFactor();
		if (zoom !== 1) {
			observedWidth = observedWidth / zoom;
			observedHeight = observedHeight / zoom;
		}
		observedWidth = Math.max(5, observedWidth);
		observedHeight = Math.max(5, observedHeight);
		if (this._width !== observedWidth || this._height !== observedHeight) {
			this._width = observedWidth;
			this._height = observedHeight;
			if (emitEvent) {
				this._onDidChange.fire();
			}
		}
	}
}
