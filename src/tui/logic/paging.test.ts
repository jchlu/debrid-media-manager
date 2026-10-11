import {
	applyPageLoaded,
	canGoBack,
	canGoForward,
	describePaging,
	FIRST_PAGE,
	planPageMove,
	type PagingState,
} from '@/tui/logic/paging';
import type { GridRow } from '@/tui/logic/types';
import { describe, expect, it } from 'vitest';

const rows = (n: number): GridRow[] =>
	Array.from({ length: n }, (_, i) => ({ hash: String(i) }) as GridRow);

const at = (state: Partial<PagingState>): PagingState => ({ ...FIRST_PAGE, ...state });

describe('planPageMove', () => {
	it('fetches the next page when nothing beyond the current one is held', () => {
		expect(planPageMove(FIRST_PAGE, 1)).toEqual({ action: 'fetch', page: 1 });
		expect(planPageMove(at({ page: 3, loaded: 3 }), 1)).toEqual({ action: 'fetch', page: 4 });
	});

	it('steps through pages it already has, without asking DMM again', () => {
		// Paging back is the common case while looking for a release, and a request
		// per press would spend the rate limit on scrolling.
		expect(planPageMove(at({ page: 0, loaded: 3 }), 1)).toEqual({ action: 'move', page: 1 });
		expect(planPageMove(at({ page: 2, loaded: 3 }), -1)).toEqual({ action: 'move', page: 1 });
	});

	it('stays put going back from the first page', () => {
		expect(planPageMove(FIRST_PAGE, -1)).toEqual({ action: 'stay' });
	});

	it('stays put going forward from a page that came back empty', () => {
		// Otherwise the key looks dead but still spends a request every press.
		expect(planPageMove(at({ page: 2, loaded: 2, exhausted: true }), 1)).toEqual({
			action: 'stay',
		});
	});
});

describe('applyPageLoaded', () => {
	it('moves to the fetched page and records how far the client has got', () => {
		const next = applyPageLoaded(at({ page: 0, loaded: 0 }), 1, rows(100));
		expect(next).toEqual({ page: 1, loaded: 1, exhausted: false });
	});

	it('keeps the furthest page reached when paging back', () => {
		const next = applyPageLoaded(at({ page: 1, loaded: 3 }), 2, rows(100));
		expect(next.loaded).toBe(3);
		expect(next.page).toBe(2);
	});

	it('ends the list on an empty page, even after a full one', () => {
		const next = applyPageLoaded(FIRST_PAGE, 1, []);
		expect(next.exhausted).toBe(true);
	});

	it('does not treat a short page as the end', () => {
		// `results` is deduplicated by hash on the way in, so a full page of 100
		// server rows can render as 82. Reading that as "last" would hide the rest.
		const next = applyPageLoaded(FIRST_PAGE, 1, rows(82));
		expect(next.exhausted).toBe(false);
	});
});

describe('the hints', () => {
	it('knows whether either key does anything', () => {
		expect(canGoBack(FIRST_PAGE)).toBe(false);
		expect(canGoForward(FIRST_PAGE)).toBe(true);
		expect(canGoForward(at({ exhausted: true }))).toBe(false);
	});

	it('describes the position without claiming a total it does not have', () => {
		expect(describePaging(FIRST_PAGE)).toBe('page 1, more after');
		expect(describePaging(at({ page: 2, exhausted: true }))).toBe('page 3, last');
	});
});
