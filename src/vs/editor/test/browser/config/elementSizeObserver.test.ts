/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ElementSizeObserver } from '../../../browser/config/elementSizeObserver.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('ElementSizeObserver', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let container: HTMLElement;
	let editorDomNode: HTMLElement;

	setup(() => {
		container = document.createElement('div');
		container.style.width = '400px';
		container.style.height = '300px';
		container.style.overflow = 'hidden';

		// Stands in for the `.monaco-editor` node that local zoom targets; it is
		// a child of the observed container, exactly like in `CodeEditorWidget`.
		editorDomNode = document.createElement('div');
		container.appendChild(editorDomNode);
		document.body.appendChild(container);
	});

	teardown(() => {
		container.remove();
	});

	function create(dimension?: { width: number; height: number }): ElementSizeObserver {
		return disposables.add(new ElementSizeObserver(container, dimension));
	}

	test('reports the container size unchanged when there is no local zoom', () => {
		const observer = create();
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [400, 300]);
	});

	test('converts an explicit dimension into the zoomed element\'s local space', () => {
		const observer = create({ width: 400, height: 300 });
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [400, 300]);

		editorDomNode.style.setProperty('zoom', '2', 'important');
		observer.setZoomDomElement(editorDomNode);

		// Laying out at 200x150 local pixels is what makes the editor render at
		// exactly 400x300 on screen instead of spilling out of its container.
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [200, 150]);
	});

	test('converts a measured container size into the zoomed element\'s local space', () => {
		const observer = create();
		editorDomNode.style.setProperty('zoom', '2', 'important');
		observer.setZoomDomElement(editorDomNode);
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [200, 150]);
	});

	test('keeps using the owner\'s explicit dimension when the zoom factor changes', () => {
		const observer = create({ width: 800, height: 600 });
		observer.setZoomDomElement(editorDomNode);
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [800, 600], 'no zoom yet');

		editorDomNode.style.setProperty('zoom', '2', 'important');
		observer.remeasure();

		// The explicit 800x600 must be replayed (and halved), *not* silently
		// replaced by the container's own 400x300 measurement.
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [400, 300]);
	});

	test('zooming out enlarges the local layout box', () => {
		const observer = create({ width: 400, height: 300 });
		editorDomNode.style.setProperty('zoom', '0.5', 'important');
		observer.setZoomDomElement(editorDomNode);
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [800, 600]);
	});

	test('restores the unzoomed size once zoom goes back to 1', () => {
		const observer = create({ width: 400, height: 300 });
		editorDomNode.style.setProperty('zoom', '2', 'important');
		observer.setZoomDomElement(editorDomNode);
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [200, 150]);

		editorDomNode.style.removeProperty('zoom');
		observer.remeasure();
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [400, 300]);
	});

	test('fires a change event when the local zoom factor changes the reported size', () => {
		const observer = create({ width: 400, height: 300 });
		observer.setZoomDomElement(editorDomNode);
		let changes = 0;
		disposables.add(observer.onDidChange(() => changes++));

		editorDomNode.style.setProperty('zoom', '2', 'important');
		observer.remeasure();
		assert.strictEqual(changes, 1);

		// Same zoom factor, same sizing input: nothing to report.
		observer.remeasure();
		assert.strictEqual(changes, 1);
	});

	test('clearing the zoom element goes back to outer sizing', () => {
		const observer = create({ width: 400, height: 300 });
		editorDomNode.style.setProperty('zoom', '2', 'important');
		observer.setZoomDomElement(editorDomNode);
		assert.strictEqual(observer.getWidth(), 200);

		observer.setZoomDomElement(null);
		assert.deepStrictEqual([observer.getWidth(), observer.getHeight()], [400, 300]);
	});
});
