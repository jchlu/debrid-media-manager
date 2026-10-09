import type { Release } from '@/tui/dmm/releases';
import { mayAdd, toGridRow, toGridRows, visibleRows } from '@/tui/logic/normalise';
import { canAdd, fileStats, isArchiveName, tbState } from '@/tui/logic/types';
import type { ProbeFile, ProbeResult } from '@/tui/torbox/probe';
import { describe, expect, it } from 'vitest';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);
const HASH_C = 'c'.repeat(40);
const HASH_D = 'd'.repeat(40);

const OFF = { showUncached: false, showArchiveOnly: false };

const release = (hash: string, over: Partial<Release> = {}): Release => ({
	hash,
	title: `release ${hash.slice(0, 4)}`,
	fileSize: 1000,
	...over,
});

const video = (id: number, name: string, bytes: number): ProbeFile => ({ id, name, size: bytes });
const MB = 1024 * 1024;
const GB = 1024 * MB;

function probe(over: Partial<ProbeResult> = {}): ProbeResult {
	return { cached: new Set(), unknown: new Set(), files: new Map(), ...over };
}

/** A cached row whose listing holds one playable file. */
function instantProbe(hash: string, bytes = 100 * MB, files?: ProbeFile[]): ProbeResult {
	return probe({
		cached: new Set([hash]),
		files: new Map([[hash, files ?? [video(9, 'a.mkv', bytes)]]]),
	});
}

describe('isArchiveName', () => {
	it.each(['a.zip', 'a.rar', 'a.7z', 'a.r01', 'A.ZIP'])('calls %s an archive', (name) => {
		expect(isArchiveName(name)).toBe(true);
	});

	it.each(['a.mkv', 'a.mp4', 'a.ts', 'a.m2ts'])('does not call %s an archive', (name) => {
		expect(isArchiveName(name)).toBe(false);
	});
});

describe('fileStats', () => {
	it('counts only playable video, ignoring samples and trailers', () => {
		const stats = fileStats([
			video(1, 'show.s01e01.mkv', 700 * MB),
			video(2, 'show.s01e02.mkv', 900 * MB),
			video(3, 'sample.mkv', 50 * MB),
			video(4, 'trailer.mp4', 40 * MB),
		]);
		expect(stats.videoCount).toBe(2);
		expect(stats.biggestVideoMb).toBeCloseTo(900);
	});

	it('takes the median of an even count from the two middle values', () => {
		const stats = fileStats([video(1, 'a.mkv', 100 * MB), video(2, 'b.mkv', 200 * MB)]);
		expect(stats.medianVideoMb).toBeCloseTo(150);
	});

	it('takes the median of an odd count from the middle value', () => {
		const stats = fileStats([
			video(1, 'a.mkv', 100 * MB),
			video(2, 'b.mkv', 200 * MB),
			video(3, 'c.mkv', 400 * MB),
		]);
		expect(stats.medianVideoMb).toBeCloseTo(200);
	});

	it('averages for the mean a season pack is judged on', () => {
		const stats = fileStats([video(1, 'a.mkv', 100 * MB), video(2, 'b.mkv', 300 * MB)]);
		expect(stats.meanVideoMb).toBeCloseTo(200);
	});

	it('reports zeros for a listing with no video at all', () => {
		expect(fileStats([video(1, 'readme.txt', 5 * MB)])).toEqual({
			videoCount: 0,
			biggestVideoMb: 0,
			medianVideoMb: 0,
			meanVideoMb: 0,
		});
	});

	it('reports zeros for no listing at all', () => {
		expect(fileStats([]).videoCount).toBe(0);
	});
});

describe('tbState', () => {
	const files = [video(1, 'a.mkv', 100 * MB)];

	it('calls a cached playable row instant', () => {
		expect(tbState({ cached: true, unknown: false, files, hasArchive: false })).toBe('instant');
	});

	it('calls a cached row with only archives an archive', () => {
		expect(
			tbState({
				cached: true,
				unknown: false,
				files: [video(1, 'a.zip', 1 * MB)],
				hasArchive: true,
			})
		).toBe('archive');
	});

	it('calls an uncached row uncached', () => {
		expect(tbState({ cached: false, unknown: false, files: [], hasArchive: false })).toBe(
			'uncached'
		);
	});

	it('prefers unknown over uncached when the probe did not answer', () => {
		// The whole reason unknown exists: a Torbox hiccup must not read as
		// "Torbox does not have this".
		expect(tbState({ cached: false, unknown: true, files: [], hasArchive: false })).toBe(
			'unknown'
		);
	});
});

describe('canAdd', () => {
	it('allows an instant row and nothing else', () => {
		expect(canAdd('instant')).toBe(true);
		expect(canAdd('archive')).toBe(false);
		expect(canAdd('uncached')).toBe(false);
		expect(canAdd('unknown')).toBe(false);
	});
});

describe('toGridRow', () => {
	it('reads the whole verdict and the listing off one probe', () => {
		const row = toGridRow(release(HASH_A, { fileSize: 7 }), instantProbe(HASH_A, 100 * MB));
		expect(row).toMatchObject({
			state: 'instant',
			videoCount: 1,
			biggestVideoMb: 100,
			reachable: true,
			requiresConfirm: false,
		});
	});

	it('prefers the listing total over the scraped total for a cached row', () => {
		const row = toGridRow(release(HASH_A, { fileSize: 1 }), instantProbe(HASH_A, 100 * MB));
		expect(row.totalSizeMb).toBeCloseTo(100);
	});

	it('keeps the scraped total for an uncached row, which has no listing', () => {
		const row = toGridRow(release(HASH_A, { fileSize: 4200 }), probe());
		expect(row.totalSizeMb).toBe(4200);
		expect(row.state).toBe('uncached');
		expect(row.videoCount).toBe(0);
	});

	it('marks a cached archive as one to unpack rather than play', () => {
		const row = toGridRow(
			release(HASH_A),
			probe({
				cached: new Set([HASH_A]),
				files: new Map([[HASH_A, [video(1, 'disc.zip', 40 * GB)]]]),
			})
		);
		expect(row.state).toBe('archive');
		expect(row.reachable).toBe(false);
	});

	it('lowercases the hash it keys on', () => {
		const row = toGridRow(release(HASH_A.toUpperCase()), probe());
		expect(row.hash).toBe(HASH_A);
	});
});

describe('visibleRows', () => {
	const rows = (): ReturnType<typeof toGridRows> =>
		toGridRows(
			[
				release(HASH_A, { fileSize: 500 }),
				release(HASH_B, { fileSize: 400 }),
				release(HASH_C, { fileSize: 300 }),
				release(HASH_D, { fileSize: 200 }),
			],
			probe({
				cached: new Set([HASH_A, HASH_C]),
				files: new Map([
					[HASH_A, [video(1, 'a.mkv', 900 * MB)]],
					[HASH_C, [video(1, 'c.zip', 800 * MB)]],
				]),
				unknown: new Set([HASH_D]),
			})
		);

	it('shows only cached, playable rows by default', () => {
		expect(visibleRows(rows(), OFF).map((r) => r.hash)).toEqual([HASH_A]);
	});

	it('is the default grid of exactly one reachable row', () => {
		// The safety property, stated as a count: with nothing configured, one
		// keypress can only reach a row that costs nothing and plays.
		expect(visibleRows(rows(), OFF).filter((r) => r.reachable)).toHaveLength(1);
	});

	it('reveals archives when asked, without making them addable', () => {
		const shown = visibleRows(rows(), { showUncached: false, showArchiveOnly: true });
		expect(shown.map((r) => r.state).sort()).toEqual(['archive', 'instant']);
		expect(
			mayAdd(shown.find((r) => r.state === 'archive')!, {
				showUncached: false,
				showArchiveOnly: true,
			})
		).toBe(false);
	});

	it('reveals uncached rows when asked, and then permits them', () => {
		const guards = { showUncached: true, showArchiveOnly: false };
		const shown = visibleRows(rows(), guards);
		expect(shown.some((r) => r.state === 'uncached')).toBe(true);
		expect(mayAdd(shown.find((r) => r.state === 'uncached')!, guards)).toBe(true);
	});

	it('never shows an unknown row, whatever the toggles say', () => {
		// A row whose verdict failed is not evidence of anything, so no
		// combination of toggles offers it.
		for (const guards of [
			OFF,
			{ showUncached: true, showArchiveOnly: false },
			{ showUncached: true, showArchiveOnly: true },
		]) {
			expect(visibleRows(rows(), guards).some((r) => r.state === 'unknown')).toBe(false);
		}
	});

	it('sorts cached first, then biggest watched file', () => {
		const many = toGridRows(
			[release(HASH_A, { fileSize: 9999 }), release(HASH_B, { fileSize: 1 })],
			probe({
				cached: new Set([HASH_A, HASH_B]),
				files: new Map([
					[HASH_A, [video(1, 'a.mkv', 100 * MB)]],
					[HASH_B, [video(1, 'b.mkv', 400 * MB)]],
				]),
			})
		);
		// HASH_B ranks first despite a far smaller total: it is the file you would
		// actually watch.
		expect(visibleRows(many, OFF).map((r) => r.hash)).toEqual([HASH_B, HASH_A]);
	});

	it('sorts uncached rows by total, since they have no listing to rank on', () => {
		const guards = { showUncached: true, showArchiveOnly: false };
		const uncached = toGridRows(
			[release(HASH_A, { fileSize: 100 }), release(HASH_B, { fileSize: 900 })],
			probe()
		);
		expect(visibleRows(uncached, guards).map((r) => r.hash)).toEqual([HASH_B, HASH_A]);
	});
});

describe('mayAdd', () => {
	it('permits an instant row under any toggles', () => {
		for (const guards of [OFF, { showUncached: true, showArchiveOnly: true }]) {
			expect(mayAdd(toGridRow(release(HASH_A), instantProbe(HASH_A)), guards)).toBe(true);
		}
	});

	it('refuses an archive even with archives revealed', () => {
		const row = toGridRow(
			release(HASH_A),
			probe({ cached: new Set([HASH_A]), files: new Map([[HASH_A, [video(1, 'a.zip', 1)]]]) })
		);
		expect(mayAdd(row, { showUncached: true, showArchiveOnly: true })).toBe(false);
	});

	it('refuses an unknown row even with everything on', () => {
		const row = toGridRow(release(HASH_A), probe({ unknown: new Set([HASH_A]) }));
		expect(mayAdd(row, { showUncached: true, showArchiveOnly: true })).toBe(false);
	});
});
