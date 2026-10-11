import type { GridRow } from '@/tui/logic/types';

/**
 * Which page of releases the grid is showing.
 *
 * DMM paginates `/api/torrents/movie` at about 100 rows a page, which the grid had
 * no way to move between: it fetched page 0 and stopped, so a title with 200
 * releases showed the first 100 and said nothing about the rest. There is no total
 * count in the response either — `results` is a bare array — so "is there more?"
 * can only be answered by asking.
 *
 * Going *back* never asks. Pages already fetched are kept, so paging back through
 * what you have seen is instant, and only ever paging forward crosses the serial
 * queue to spend a rate-limited request.
 */

export type PagingState = {
	/** The page on screen. DMM numbers from 0. */
	page: number;
	/** The highest page fetched, so `-1` means only page 0 has been seen. */
	loaded: number;
	/**
	 * True once a fetched page came back empty.
	 *
	 * Compared against the page size rather than used as a rule directly: `results`
	 * is deduplicated by hash on the way in, so a full page can legitimately render
	 * as fewer rows than the server sent. An empty page is the only honest end.
	 */
	exhausted: boolean;
};

export const FIRST_PAGE: PagingState = { page: 0, loaded: 0, exhausted: false };

export type PageMove =
	/** Already at the end in that direction; nothing to do. */
	| { action: 'stay' }
	/** Move to an already-fetched page. No request. */
	| { action: 'move'; page: number }
	/** A page that has never been fetched. Costs a paced DMM request. */
	| { action: 'fetch'; page: number };

/** What pressing `[` or `]` should do, without doing it. */
export function planPageMove(state: PagingState, direction: -1 | 1): PageMove {
	if (direction === -1) {
		return state.page > 0 ? { action: 'move', page: state.page - 1 } : { action: 'stay' };
	}
	if (state.page < state.loaded) return { action: 'move', page: state.page + 1 };
	if (state.exhausted) return { action: 'stay' };
	return { action: 'fetch', page: state.page + 1 };
}

/** Folds a freshly fetched page into the paging state. */
export function applyPageLoaded(
	state: PagingState,
	page: number,
	rows: readonly GridRow[]
): PagingState {
	return {
		page,
		loaded: Math.max(state.loaded, page),
		// An empty page ends the list. The page is still marked loaded so that
		// paging back to it shows an honest "nothing on this page" rather than
		// silently skipping it.
		exhausted: state.exhausted || rows.length === 0,
	};
}

/** Whether `[` would do anything, for the key hint. */
export const canGoBack = (state: PagingState) => state.page > 0;

/** Whether `]` would do anything, for the key hint. */
export const canGoForward = (state: PagingState) => planPageMove(state, 1).action !== 'stay';

/** `page 3` / `page 3, last` / `page 3, more after`. */
export function describePaging(state: PagingState): string {
	const base = `page ${state.page + 1}`;
	if (state.exhausted) return `${base}, last`;
	return canGoForward(state) ? `${base}, more after` : base;
}
