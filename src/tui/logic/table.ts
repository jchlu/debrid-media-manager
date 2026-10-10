import type { GridRow } from '@/tui/logic/types';
import { getEpisodeCountLabel } from '@/utils/episodeUtils';
import stringWidth from 'string-width';

/**
 * The results grid, as a pure function.
 *
 * Ink lays out with flexbox, which is the wrong primitive for a fixed-width table:
 * columns need fixed widths, the title needs truncation, and the visible window
 * needs to be a function of the terminal height. So the grid is computed here and
 * handed to a component that owns no logic — which also means the parts that
 * actually break a table (width arithmetic, truncation, unicode) are testable
 * without a terminal at all.
 *
 * Truncation runs right to left, columns first and the title last, because the
 * title is the only column carrying no other information. The title itself
 * truncates from the *left*, with a leading ellipsis: a release name identifies
 * itself by its tail (`2160p.WEB-DL.HDR.DV`), and its head is the part already
 * known.
 */

/** In order of how much each column is worth keeping; dropped from the end. */
export const COLUMN_ORDER = [
	'marker',
	'state',
	'title',
	'videos',
	'total',
	'biggest',
	'episodes',
] as const;

export type ColumnId = (typeof COLUMN_ORDER)[number];

const FIXED_WIDTH: Record<Exclude<ColumnId, 'title'>, number> = {
	marker: 2,
	state: 7,
	videos: 4,
	total: 15,
	biggest: 17,
	// Wide enough for `With extras (10/8)`, the longest label
	// `getEpisodeCountLabel` produces — 18 columns, not 17.
	episodes: 18,
};

/** Below this the title stops being readable, so nothing else is worth keeping. */
export const MIN_TITLE_WIDTH = 12;

/** A terminal narrower than this cannot show a usable grid at all. */
export const MIN_GRID_WIDTH = 40;

const GAP = ' ';

export const STATE_LABEL: Record<GridRow['state'], string> = {
	instant: 'INSTANT',
	uncached: 'DL',
	archive: 'ARCHIVE',
	unknown: '—',
};

/** Visible columns of a string, which is not its `.length`. */
export const displayWidth = (text: string): number => stringWidth(text);

/** MB, rendered in GB once it is big enough for the conversion to be worth it. */
export function formatSize(mb: number): string {
	if (!Number.isFinite(mb) || mb <= 0) return '—';
	return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

/**
 * Cuts to `max` columns, keeping the head.
 *
 * Iterates by code point rather than by index: a surrogate pair is one character,
 * and cutting between its halves leaves a lone surrogate that renders as a
 * replacement glyph.
 */
export function truncateRight(text: string, max: number): string {
	if (max <= 0) return '';
	if (displayWidth(text) <= max) return text;
	const out: string[] = [];
	let used = 0;
	for (const char of text) {
		const charWidth = displayWidth(char);
		if (used + charWidth > max - 1) break;
		out.push(char);
		used += charWidth;
	}
	return `${out.join('')}…`;
}

/** Cuts to `max` columns, keeping the tail. */
export function truncateLeft(text: string, max: number): string {
	if (max <= 0) return '';
	if (displayWidth(text) <= max) return text;
	const chars = [...text];
	const kept: string[] = [];
	let used = 1; // the leading ellipsis
	for (let i = chars.length - 1; i >= 0; i--) {
		const charWidth = displayWidth(chars[i]);
		if (used + charWidth > max) break;
		kept.unshift(chars[i]);
		used += charWidth;
	}
	return `…${kept.join('')}`;
}

/**
 * The three cell alignments, named for where the content sits rather than for
 * which end is kept — the two are different axes and conflating them is how a
 * selection marker ends up in column 2.
 */
export const cellStart = (text: string, max: number): string => {
	const fitted = truncateRight(text, max);
	return fitted + ' '.repeat(Math.max(0, max - displayWidth(fitted)));
};

export const cellEnd = (text: string, max: number): string => {
	const fitted = truncateRight(text, max);
	return ' '.repeat(Math.max(0, max - displayWidth(fitted))) + fitted;
};

/** Keeps the tail — for a release name, which says what it is at the end. */
export const cellTail = (text: string, max: number): string => {
	const fitted = truncateLeft(text, max);
	return fitted + ' '.repeat(Math.max(0, max - displayWidth(fitted)));
};

/**
 * Which columns fit in `width`.
 *
 * Dropped from the end of `COLUMN_ORDER` until the row fits, so a narrow terminal
 * loses the episode count before it loses the title.
 */
export function layoutColumns(
	available: number,
	{ includeEpisodes }: { includeEpisodes: boolean }
): ColumnId[] {
	const kept = [...COLUMN_ORDER];
	if (!includeEpisodes) {
		const at = kept.indexOf('episodes');
		if (at !== -1) kept.splice(at, 1);
	}

	const cost = () =>
		kept.reduce((sum, id) => sum + (id === 'title' ? MIN_TITLE_WIDTH : FIXED_WIDTH[id]), 0) +
		GAP.length * (kept.length - 1);

	// `marker` and `state` always stay: without them a row has no meaning.
	while (kept.length > 2 && cost() > available) {
		const victim = kept[kept.length - 1];
		kept.splice(kept.indexOf(victim), 1);
	}
	return kept;
}

/** How much room the title gets once every other column is placed. */
export function titleWidthFor(columns: ColumnId[], available: number): number {
	const fixed = columns.reduce((sum, id) => sum + (id === 'title' ? 0 : FIXED_WIDTH[id]), 0);
	return Math.max(MIN_TITLE_WIDTH, available - fixed - GAP.length * (columns.length - 1));
}

type Cells = Record<ColumnId, string>;

function buildCells(row: GridRow, expectedEpisodes: number | undefined): Cells {
	return {
		marker: '',
		state: STATE_LABEL[row.state],
		title: row.title,
		videos: String(row.videoCount),
		total: `Total: ${formatSize(row.totalSizeMb)}`,
		// A season is judged on the average episode it would play; a movie on its
		// single file. Same asymmetry the web grid uses.
		biggest:
			expectedEpisodes === undefined
				? `Biggest: ${formatSize(row.biggestVideoMb)}`
				: `Median: ${formatSize(row.medianVideoMb)}`,
		episodes:
			expectedEpisodes === undefined
				? ''
				: getEpisodeCountLabel(row.videoCount, expectedEpisodes),
	};
}

/** One row, as a line of exactly `available` columns. */
export function renderRow(
	row: GridRow,
	options: { width: number; selected?: boolean; expectedEpisodes?: number }
): string {
	// `selected` defaults to false because most callers — a test, a one-off
	// preview — want the row, not a row with a marker in it.
	const { width, selected = false, expectedEpisodes } = options;
	const columns = layoutColumns(width, { includeEpisodes: expectedEpisodes !== undefined });
	const titleWidth = titleWidthFor(columns, width);
	const cells = buildCells(row, expectedEpisodes);
	cells.marker = selected ? '▸' : '';

	const parts = columns.map((id) => {
		const cellWidth = id === 'title' ? titleWidth : FIXED_WIDTH[id];
		// Three alignments, and each exists for a reason:
		//  - the marker hugs the left edge, so a selection reads at column 0;
		//  - the title keeps its tail, because a release name says what it is at
		//    the end — but still occupies the cell from the left;
		//  - everything else hugs the right edge, so `Incomplete (5/8)` never
		//    renders as `…complete (5/8)` and the counts line up down the grid.
		if (id === 'title') return cellTail(cells.title, cellWidth);
		if (id === 'videos') return cellEnd(cells.videos, cellWidth);
		return cellStart(cells[id], cellWidth);
	});
	return parts.join(GAP);
}

export type RenderOptions = {
	width: number;
	/** How many rows the visible window shows. */
	height: number;
	selectedIndex: number;
	/** A number makes this a season: median and episode labels are shown. */
	expectedEpisodes?: number;
};

/**
 * The visible window of rows.
 *
 * The window follows the selection rather than scrolling independently, so the
 * selected row is always visible without the caller computing an offset.
 */
export function renderRows(rows: GridRow[], options: RenderOptions): string[] {
	const { width, height, selectedIndex, expectedEpisodes } = options;
	if (width < MIN_GRID_WIDTH || height < 1 || rows.length === 0) return [];

	const columns = layoutColumns(width, { includeEpisodes: expectedEpisodes !== undefined });
	const titleWidth = titleWidthFor(columns, width);
	if (titleWidth < MIN_TITLE_WIDTH) return [];

	const visible = Math.min(rows.length, height);
	const start = Math.max(
		0,
		Math.min(selectedIndex - Math.floor(visible / 2), rows.length - visible)
	);

	return rows.slice(start, start + visible).map((row, offset) =>
		renderRow(row, {
			width,
			selected: start + offset === selectedIndex,
			expectedEpisodes,
		})
	);
}

/** `12 of 340`, for the footer. */
export function position(selectedIndex: number, total: number): string {
	return `${Math.min(selectedIndex + 1, total)} of ${total}`;
}
