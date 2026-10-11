import { applyFilter, describeEmptyFilter, matchesTerm, parseVideoCount } from '@/tui/logic/filter';
import type { GridRow } from '@/tui/logic/types';
import { describe, expect, it } from 'vitest';

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';

const row = (over: Partial<GridRow> = {}): GridRow => ({
	hash: HASH,
	title: 'Blade.Runner.1982.2160p.UHD.BluRay.x265',
	state: 'instant',
	requiresConfirm: false,
	reachable: true,
	videoCount: 1,
	totalSizeMb: 60000,
	biggestVideoMb: 60000,
	medianVideoMb: 60000,
	meanVideoMb: 60000,
	...over,
});

const season = row({
	hash: 'ffffffffffffffffffffffffffffffffffffffff',
	title: 'Severance.S02.1080p.WEB-DL',
	state: 'uncached',
	reachable: false,
	requiresConfirm: true,
	// What `normalise.ts` actually produces: an uncached hash has no Torbox
	// listing, so the measured count is zero however many episodes the pack has.
	videoCount: 0,
});

describe('parseVideoCount', () => {
	it('reads the three spellings the browser accepts', () => {
		expect(parseVideoCount('videos:10')).toEqual({ count: 10, cmp: 'eq' });
		expect(parseVideoCount('videos:<10')).toEqual({ count: 10, cmp: 'lt' });
		expect(parseVideoCount('videos:>10')).toEqual({ count: 10, cmp: 'gt' });
	});

	it('is not a video term at all, rather than one that matches nothing', () => {
		expect(parseVideoCount('videos:')).toBeNull();
		expect(parseVideoCount('videos:ten')).toBeNull();
		expect(parseVideoCount('blade')).toBeNull();
	});
});

describe('matchesTerm', () => {
	it('matches a title as a regular expression', () => {
		expect(matchesTerm(row(), 'blade.*2160p')).toBe(true);
		expect(matchesTerm(row(), 'dune')).toBe(false);
	});

	it('matches the hash by prefix, since the grid shows a prefix', () => {
		// The 12 characters on screen have to be pasteable back in.
		expect(matchesTerm(row(), 'abcdef012345')).toBe(true);
		expect(matchesTerm(row(), HASH)).toBe(true);
		expect(matchesTerm(row(), 'abcdef0123456')).toBe(true);
		expect(matchesTerm(row(), 'nope')).toBe(false);
	});

	it('survives a half-typed regular expression', () => {
		// Blanking the whole grid mid-word is worse than matching nothing.
		expect(() => matchesTerm(row(), 'blade[')).not.toThrow();
		expect(matchesTerm(row(), 'blade[')).toBe(false);
	});

	it('negates with a leading hyphen', () => {
		expect(matchesTerm(row(), '-dune')).toBe(true);
		expect(matchesTerm(row(), '-blade')).toBe(false);
		// An operator negates too: not cached.
		expect(matchesTerm(row(), '-is:uncached')).toBe(true);
		expect(matchesTerm(season, '-is:uncached')).toBe(false);
	});

	it('ignores a lone hyphen, which is a separator people type', () => {
		expect(matchesTerm(row(), '-')).toBe(true);
	});

	describe('is:', () => {
		it('maps the browser names onto this grid’s states', () => {
			expect(matchesTerm(row(), 'is:tb')).toBe(true);
			expect(matchesTerm(row(), 'is:cached')).toBe(true);
			expect(matchesTerm(season, 'is:uncached')).toBe(true);
			expect(matchesTerm(row({ state: 'archive' }), 'is:archive')).toBe(true);
		});

		it('knows what this session has added', () => {
			expect(matchesTerm(row({ added: true }), 'is:added')).toBe(true);
			expect(matchesTerm(row(), 'is:added')).toBe(false);
		});

		it('matches nothing for an operator it does not have', () => {
			// Silently passing would show everything and read as "no effect".
			expect(matchesTerm(row(), 'is:rd')).toBe(false);
			expect(matchesTerm(row(), 'is:nonsense')).toBe(false);
		});
	});

	describe('videos:', () => {
		it('compares the measured video count', () => {
			const ten = row({ videoCount: 10 });
			expect(matchesTerm(ten, 'videos:10')).toBe(true);
			expect(matchesTerm(row(), 'videos:10')).toBe(false);
			expect(matchesTerm(row(), 'videos:>0')).toBe(true);
			expect(matchesTerm(ten, 'videos:>10')).toBe(false);
			expect(matchesTerm(row(), 'videos:<10')).toBe(true);
		});

		it('counts an uncached row as zero, which is what Torbox reports', () => {
			// Pinned deliberately. A season pack named S01E01-E10 still counts as zero
			// until Torbox lists it, so `videos:>0` finds cached rows only. If this
			// ever changes it is because the count became an estimate, and then the
			// operator is claiming something it has not measured.
			expect(matchesTerm(season, 'videos:>0')).toBe(false);
			expect(matchesTerm(season, 'videos:0')).toBe(true);
		});
	});
});

describe('applyFilter', () => {
	it('returns everything for an empty query', () => {
		const rows = [row(), season];
		expect(applyFilter(rows, '')).toBe(rows);
		expect(applyFilter(rows, '   ')).toBe(rows);
	});

	it('requires every term to match', () => {
		const rows = [row(), season];
		expect(applyFilter(rows, 'blade')).toEqual([row()]);
		expect(applyFilter(rows, 'blade severance')).toEqual([]);
	});

	it('combines a positive and a negated term', () => {
		const rows = [row(), season, row({ title: 'Dune.2021.2160p', state: 'uncached' })];
		expect(applyFilter(rows, 'is:uncached -severance')).toEqual([
			row({ title: 'Dune.2021.2160p', state: 'uncached' }),
		]);
	});
});

describe('describeEmptyFilter', () => {
	it('names an operator it does not recognise, which is the fixable mistake', () => {
		// An unmatched `videos:>12` and a typo look identical otherwise.
		expect(describeEmptyFilter('is:rd')).toContain('is:rd');
		expect(describeEmptyFilter('is:rd')).toContain('is:uncached');
		expect(describeEmptyFilter('videos:>12')).not.toContain('is:uncached');
	});
});
