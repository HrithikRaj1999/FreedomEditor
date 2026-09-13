import assert from 'assert';
import { installElementZoom, type IElementZoomController } from '../../browser/elementZoom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('Local Element Zoom', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let container: HTMLElement;
	let target: HTMLElement;
	let sibling: HTMLElement;
	let controller: IElementZoomController;
	let enabled: boolean;

	setup(() => {
		container = document.createElement('main');
		target = document.createElement('div');
		sibling = document.createElement('div');
		target.append(document.createElement('span'), document.createElement('span'));
		target.children[0].textContent = 'First text';
		target.children[1].textContent = 'Second text';
		sibling.textContent = 'Neighbor';
		container.append(target, sibling);
		document.body.append(container);
		enabled = true;
		controller = disposables.add(installElementZoom(container, () => enabled));
	});

	teardown(() => {
		container.remove();
	});

	function wheel(element: Element, options: WheelEventInit = {}): WheelEvent {
		const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, ctrlKey: true, deltaY: -100, ...options });
		element.dispatchEvent(event);
		return event;
	}

	test('zooms the containing div without changing its siblings or parent', () => {
		const event = wheel(target.children[0]);
		assert.deepStrictEqual({
			target: target.style.zoom,
			sibling: sibling.style.zoom,
			parent: container.style.zoom,
			child: (target.children[1] as HTMLElement).style.zoom,
			prevented: event.defaultPrevented
		}, { target: '1.1', sibling: '', parent: '', child: '', prevented: true });
	});

	test('leaves normal scrolling, other modifiers, and disabled zoom unchanged', () => {
		const normal = wheel(target, { ctrlKey: false });
		const horizontal = wheel(target, { shiftKey: true });
		const alternate = wheel(target, { altKey: true });
		const empty = wheel(target, { deltaY: 0 });
		enabled = false;
		const disabled = wheel(target);
		assert.deepStrictEqual([target.style.zoom, normal.defaultPrevented, horizontal.defaultPrevented, alternate.defaultPrevented, empty.defaultPrevented, disabled.defaultPrevented], ['', false, false, false, false, false]);
	});

	test('does not zoom the outer container', () => {
		const event = wheel(container);
		assert.deepStrictEqual([container.style.zoom, event.defaultPrevented], ['', false]);
	});

	test('stops other wheel handlers from also zooming', () => {
		let handled = false;
		target.addEventListener('wheel', () => { handled = true; }, { once: true });
		wheel(target);
		assert.strictEqual(handled, false);
	});

	test('keeps zoom within readable bounds', () => {
		for (let index = 0; index < 50; index++) {
			wheel(target);
		}
		const maximum = target.style.zoom;
		for (let index = 0; index < 50; index++) {
			wheel(target, { deltaY: 100 });
		}
		assert.deepStrictEqual([maximum, target.style.zoom], ['3', '0.5']);
	});

	test('zooms fixed-layout widgets as a whole instead of individual rows', () => {
		const row = document.createElement('div');
		target.append(row);
		const actual: string[][] = [];
		for (const className of ['monaco-editor', 'monaco-list', 'xterm']) {
			target.className = className;
			wheel(row);
			actual.push([target.style.zoom, row.style.zoom, sibling.style.zoom]);
			controller.reset();
		}
		assert.deepStrictEqual(actual, [['1.1', '', ''], ['1.1', '', ''], ['1.1', '', '']]);
	});

	test('reversing the wheel restores the original zoom', () => {
		wheel(target);
		wheel(target, { deltaY: 100 });
		assert.strictEqual(target.style.zoom, '');
	});

	test('handles an iframe document without changing the outer document', () => {
		const frame = document.createElement('iframe');
		container.append(frame);
		const innerDocument = frame.contentDocument!;
		const innerTarget = innerDocument.createElement('div');
		innerDocument.body.append(innerTarget);
		disposables.add(installElementZoom(innerDocument.body));
		wheel(innerTarget);
		assert.deepStrictEqual([innerTarget.style.zoom, frame.style.zoom, container.style.zoom], ['1.1', '', '']);
	});

	test('restores existing zoom and inline priority on reset', () => {
		target.style.setProperty('zoom', '1.25', 'important');
		wheel(target);
		wheel(sibling);
		controller.reset();
		assert.deepStrictEqual([target.style.zoom, target.style.getPropertyPriority('zoom'), sibling.style.zoom], ['1.25', 'important', '']);
	});

	test('restores zoom and removes the listener on disposal', () => {
		wheel(target);
		controller.dispose();
		const event = wheel(target);
		assert.deepStrictEqual([target.style.zoom, event.defaultPrevented], ['', false]);
	});
});