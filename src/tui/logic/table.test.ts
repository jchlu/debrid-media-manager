import {
	cellEnd,
	cellStart,
	cellTail,
	displayWidth,
	formatSize,
	layoutColumns,
	MIN_GRID_WIDTH,
	position,
	renderRow,
	renderRows,
	titleWidthFor,
	truncateLeft,
	truncateRight,
} from '@/tui/logic/table';
import type { GridRow, TbState } from '@/tui/logic/types';
import { describe, expect, it } from 'vitest';

const row = (over: Partial<GridRow> = {}): GridRow => ({
	hash: 'a'.repeat(40),
	title: 'Dune.Part.Two.2024.2160p.WEB-DL.HDR.DV.H.265-GRP',
	state: 'instant',
	requiresConfirm: false,
	reachable: true,
	videoCount: 1,
	totalSizeMb: 62000,
	biggestVideoMb: 60000,
	medianVideoMb: 60000,
	meanVideoMb: 60000,
	...over,
});

const instant = (title: string) => row({ title });
const archive = () => row({ state: 'archive', videoCount: 0, reachable: false });

describe('formatSize', () => {
	it.each([
		[0, '—'],
		[-5, '—'],
		[512, '512 MB'],
		[1023, '1023 MB'],
		[1024, '1.00 GB'],
		[62000, '60.55 GB'],
	])('renders %d MB as %s', (mb, expected) => {
		expect(formatSize(mb)).toBe(expected);
	});

	it('renders a missing size as a dash rather than 0.00 GB', () => {
		// The web grid has the same rule (`totalFileSize` in utils/results.tsx):
		// a row whose size is unknown must not read as an empty one.
		expect(formatSize(NaN)).toBe('—');
	});
});

describe('truncateRight', () => {
	it('leaves a short string alone', () => {
		expect(truncateRight('abc', 5)).toBe('abc');
	});

	it('keeps the head and marks the cut', () => {
		expect(truncateRight('abcdefgh', 5)).toBe('abcd…');
	});

	it('fits exactly the requested width', () => {
		expect(displayWidth(truncateRight('abcdefgh', 5))).toBe(5);
	});

	it('does not split a wide character across the boundary', () => {
		const out = truncateRight('Человек', 4);
		expect(displayWidth(out)).toBeLessThanOrEqual(4);
		expect(out.endsWith('…')).toBe(true);
	});

	it('returns nothing for a width of zero', () => {
		expect(truncateRight('abc', 0)).toBe('');
	});
});

describe('truncateLeft', () => {
	it('keeps the tail and marks the cut', () => {
		// The ellipsis costs a column of its own, so a 5-wide cut keeps 4.
		expect(truncateLeft('abcdefgh', 5)).toBe('…efgh');
	});

	it('fits exactly the requested width', () => {
		expect(displayWidth(truncateLeft('abcdefgh', 5))).toBe(5);
	});

	it('keeps the identifying tail of a release name', () => {
		// The whole reason it truncates left: a release name says what it is at
		// the end.
		const name = 'Some.Very.Long.Movie.Name.2024.2160p.WEB-DL';
		expect(truncateLeft(name, 20)).toContain('2160p');
		expect(truncateLeft(name, 20).startsWith('…')).toBe(true);
		// Whatever the width, the end of the name is what survives.
		expect(truncateLeft(name, 14).endsWith('WEB-DL')).toBe(true);
	});

	it('counts a wide character as two columns', () => {
		expect(displayWidth(truncateLeft('Человек-Паук', 6))).toBeLessThanOrEqual(6);
	});

	it('does not split a surrogate pair', () => {
		const out = truncateLeft('🎬🎬🎬', 3);
		expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
	});
});

describe('cellStart, cellEnd and cellTail', () => {
	it('cellStart hugs the left edge', () => {
		expect(cellStart('ab', 5)).toBe('ab   ');
		expect(cellStart('▸', 2)).toBe('▸ ');
	});

	it('cellEnd hugs the right edge', () => {
		expect(cellEnd('ab', 5)).toBe('   ab');
		expect(cellEnd('1', 4)).toBe('   1');
	});

	it('cellTail keeps the end and still hugs the left', () => {
		expect(cellTail('abcdefgh', 5)).toBe('…efgh');
	});

	it.each([
		['ab', 5],
		['abcdefgh', 4],
		['Человек', 10],
		['🎬🎬', 6],
	])('every one reaches exactly the requested width for %j', (text, max) => {
		for (const fit of [cellStart, cellEnd, cellTail]) {
			expect(displayWidth(fit(text, max))).toBe(max);
		}
	});
});

describe('layoutColumns', () => {
	it('keeps everything on a wide terminal', () => {
		expect(layoutColumns(140, { includeEpisodes: true })).toContain('episodes');
	});

	it('drops the episode column before anything else', () => {
		// Every column together costs 78, so nothing is lost at 96; the episode
		// count is the first thing to go as the terminal narrows.
		expect(layoutColumns(96, { includeEpisodes: true })).toContain('episodes');
		const columns = layoutColumns(70, { includeEpisodes: true });
		expect(columns).not.toContain('episodes');
		expect(columns).toContain('title');
	});

	it('keeps only marker, state, title and the count when very narrow', () => {
		expect(layoutColumns(30, { includeEpisodes: false })).toEqual([
			'marker',
			'state',
			'title',
			'videos',
		]);
	});

	it('drops the video count too, rather than starving the title', () => {
		expect(layoutColumns(24, { includeEpisodes: false })).toEqual(['marker', 'state', 'title']);
	});

	it('omits episodes entirely for a movie', () => {
		expect(layoutColumns(140, { includeEpisodes: false })).not.toContain('episodes');
	});

	it('always keeps the marker and the state', () => {
		for (const width of [40, 60, 100, 200]) {
			const columns = layoutColumns(width, { includeEpisodes: true });
			expect(columns[0]).toBe('marker');
			expect(columns).toContain('state');
		}
	});
});

describe('titleWidthFor', () => {
	it('gives the title whatever is left over', () => {
		const columns = layoutColumns(120, { includeEpisodes: false });
		const title = titleWidthFor(columns, 120);
		expect(title).toBeGreaterThan(0);
		// Marker + state + videos + total + biggest + gaps must fit around it.
		expect(120).toBeGreaterThanOrEqual(title + 45);
	});
});

describe('renderRow', () => {
	it('fills exactly the width it is given', () => {
		for (const width of [60, 80, 100, 120, 160]) {
			expect(displayWidth(renderRow(instant('A.Movie.2024'), { width }))).toBe(width);
		}
	});

	it('marks the state in words, not colour alone', () => {
		// Colour is decoration; on a 16-colour terminal or a dumb one it is gone.
		expect(renderRow(instant('A.Movie'), { width: 120 })).toContain('INSTANT');
		expect(renderRow(archive(), { width: 120 })).toContain('ARCHIVE');
	});

	it('marks the selection with a glyph as well as being highlighted', () => {
		expect(renderRow(instant('A.Movie'), { width: 120, selected: true })).toMatch(/^▸/);
		expect(renderRow(instant('A.Movie'), { width: 120, selected: false })).not.toMatch(/^▸/);
	});

	it('shows the biggest file for a movie', () => {
		const line = renderRow(instant('A.Movie'), { width: 140 });
		expect(line).toContain('Biggest: 58.59 GB');
	});

	it('shows the median and an episode label for a season', () => {
		const line = renderRow(row({ videoCount: 8, medianVideoMb: 3900 }), {
			width: 140,
			expectedEpisodes: 8,
		});
		expect(line).toContain('Median: 3.81 GB');
		expect(line).toContain('Complete (8/8)');
	});

	it('says when a season is incomplete', () => {
		const line = renderRow(row({ videoCount: 5 }), { width: 140, expectedEpisodes: 8 });
		expect(line).toContain('Incomplete (5/8)');
	});

	it.each([
		[1, 8, 'Single'],
		[8, 8, 'Complete (8/8)'],
		[5, 8, 'Incomplete (5/8)'],
		[10, 8, 'With extras (10/8)'],
	])('renders the %i-of-%i label whole, never cut from the left', (videos, expected, label) => {
		// Every one of these is what `getEpisodeCountLabel` produces, and none may
		// appear as "…complete (5/8)".
		expect(
			renderRow(row({ videoCount: videos }), { width: 140, expectedEpisodes: expected })
		).toContain(label);
	});

	it('keeps the tail of a long title', () => {
		const line = renderRow(instant('A.Very.Long.Movie.Name.That.Will.Not.Fit.2024.2160p'), {
			width: 70,
		});
		expect(line).toContain('2160p');
	});

	it('does not shear on a CJK title', () => {
		const line = renderRow(instant('Человек-Паук.Нет.Дома.2024'), { width: 80 });
		expect(displayWidth(line)).toBe(80);
	});

	it('right-aligns the video count within its own column', () => {
		// The count's column is four wide, so 1 and 12 must end on the same column
		// index — otherwise the numbers do not line up down the grid.
		const cellFor = (videoCount: number) => {
			const line = renderRow(row({ videoCount }), { width: 120 });
			const at = line.indexOf('Total:');
			// The count's cell, then the single-space gap before `Total:`.
			return line.slice(at - 5, at - 1);
		};
		expect(cellFor(1)).toBe('   1');
		expect(cellFor(12)).toBe('  12');
	});
});

describe('renderRows', () => {
	const many = (n: number) =>
		Array.from({ length: n }, (_, i) => instant(`Movie.Number.${i}.2024.1080p`));

	it('renders nothing on a terminal too narrow to be readable', () => {
		expect(
			renderRows(many(3), { width: MIN_GRID_WIDTH - 1, height: 10, selectedIndex: 0 })
		).toEqual([]);
	});

	it('renders nothing when there are no rows', () => {
		expect(renderRows([], { width: 120, height: 10, selectedIndex: 0 })).toEqual([]);
	});

	it('shows at most the available height', () => {
		expect(renderRows(many(50), { width: 120, height: 8, selectedIndex: 0 })).toHaveLength(8);
	});

	it('shows every row when they fit', () => {
		expect(renderRows(many(3), { width: 120, height: 10, selectedIndex: 0 })).toHaveLength(3);
	});

	it('keeps the selected row visible when scrolled to the end', () => {
		const rows = many(50);
		const lines = renderRows(rows, { width: 120, height: 8, selectedIndex: 49 });
		expect(lines.some((l) => l.startsWith('▸') && l.includes('Movie.Number.49'))).toBe(true);
	});

	it('keeps the selected row visible in the middle of a long list', () => {
		const rows = many(50);
		const lines = renderRows(rows, { width: 120, height: 8, selectedIndex: 25 });
		expect(lines.some((l) => l.startsWith('▸') && l.includes('Movie.Number.25'))).toBe(true);
	});

	it('marks exactly one row as selected', () => {
		const lines = renderRows(many(20), { width: 120, height: 10, selectedIndex: 4 });
		expect(lines.filter((l) => l.startsWith('▸'))).toHaveLength(1);
	});

	it('gives every line the same width', () => {
		const lines = renderRows(many(6), { width: 97, height: 10, selectedIndex: 2 });
		for (const line of lines) expect(displayWidth(line)).toBe(97);
	});

	it('tolerates a selection past the end of a shrunken list', () => {
		// A filter can leave fewer rows than the previous selection index.
		expect(() =>
			renderRows(many(2), { width: 120, height: 10, selectedIndex: 99 })
		).not.toThrow();
	});

	it('renders every state without throwing', () => {
		const states: TbState[] = ['instant', 'uncached', 'archive', 'unknown'];
		const lines = renderRows(
			states.map((state) => row({ state })),
			{ width: 120, height: 10, selectedIndex: 0 }
		);
		expect(lines).toHaveLength(4);
	});
});

describe('position', () => {
	it('counts from one', () => {
		expect(position(0, 40)).toBe('1 of 40');
		expect(position(11, 40)).toBe('12 of 40');
	});

	it('does not claim a position past the end', () => {
		expect(position(99, 40)).toBe('40 of 40');
	});
});
