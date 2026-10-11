import { confirmSummary, decideAdd } from '@/tui/logic/addRequest';
import { formatSize } from '@/tui/logic/table';
import type { GridRow } from '@/tui/logic/types';
import { describe, expect, it } from 'vitest';

const HASH = 'a'.repeat(40);

const row = (over: Partial<GridRow> = {}): GridRow => ({
	hash: HASH,
	title: 'A.Movie.2024.2160p',
	state: 'instant',
	requiresConfirm: false,
	reachable: true,
	videoCount: 1,
	totalSizeMb: 60000,
	biggestVideoMb: 58000,
	medianVideoMb: 58000,
	meanVideoMb: 58000,
	...over,
});

const OFF = { showUncached: false, showArchiveOnly: false };
const UNCACHED_ON = { showUncached: true, showArchiveOnly: false };
const ALL_ON = { showUncached: true, showArchiveOnly: true };
const NONE = new Set<string>();

describe('decideAdd', () => {
	it('adds a cached row on the key press, with no dialog', () => {
		expect(decideAdd(row(), OFF, NONE)).toEqual({ action: 'add' });
	});

	it('asks before adding an uncached row', () => {
		const uncached = row({ state: 'uncached', reachable: false, requiresConfirm: true });
		expect(decideAdd(uncached, UNCACHED_ON, NONE)).toEqual({ action: 'confirm' });
	});

	describe('the guards', () => {
		it('refuses an archive even with archives shown', () => {
			// Adding one yields something to unpack, which is never wanted — so
			// revealing archives must not make them addable.
			const archive = row({ state: 'archive', reachable: false });
			expect(decideAdd(archive, ALL_ON, NONE)).toMatchObject({
				action: 'refuse',
				reason: 'archive',
			});
		});

		it('refuses an uncached row while the toggle is off', () => {
			const uncached = row({ state: 'uncached', reachable: false });
			expect(decideAdd(uncached, OFF, NONE)).toMatchObject({
				action: 'refuse',
				reason: 'hidden',
			});
		});

		it('refuses an unknown row under every combination of toggles', () => {
			const unknown = row({ state: 'unknown', reachable: false });
			for (const guards of [OFF, UNCACHED_ON, ALL_ON]) {
				expect(decideAdd(unknown, guards, NONE)).toMatchObject({
					action: 'refuse',
					reason: 'unknown',
				});
			}
		});

		it('never offers any row that costs nothing or plays — the core property', () => {
			// With nothing configured, every row the default grid can show is
			// instant, and `a` on it must never open a dialog.
			expect(decideAdd(row(), OFF, NONE)).toEqual({ action: 'add' });
		});
	});

	describe('repeat adds', () => {
		it('refuses a second press while the first is in flight', () => {
			// Otherwise `a` twice creates the torrent twice.
			expect(decideAdd(row(), OFF, new Set([HASH]))).toMatchObject({
				action: 'refuse',
				reason: 'in-flight',
			});
		});

		it('refuses a row that is already on the account', () => {
			expect(decideAdd(row({ added: true }), OFF, NONE)).toMatchObject({
				action: 'refuse',
				reason: 'already-added',
			});
		});

		it('checks in-flight before anything else', () => {
			// A row that is both added and in flight should say the more urgent
			// of the two things.
			expect(decideAdd(row({ added: true }), OFF, new Set([HASH]))).toMatchObject({
				reason: 'in-flight',
			});
		});

		it('ignores an in-flight set holding a different row', () => {
			expect(decideAdd(row(), OFF, new Set(['b'.repeat(40)]))).toEqual({ action: 'add' });
		});
	});

	it('refuses cleanly when the selection points past the end', () => {
		// Reachable whenever a filter shrinks the list under a standing selection.
		expect(decideAdd(undefined, OFF, NONE)).toMatchObject({ action: 'refuse', reason: 'none' });
	});

	it('always explains itself when it refuses', () => {
		const rows: (GridRow | undefined)[] = [
			row({ state: 'archive', reachable: false }),
			row({ state: 'unknown', reachable: false }),
			row({ added: true }),
			undefined,
		];
		for (const candidate of rows) {
			const decision = decideAdd(candidate, ALL_ON, NONE);
			expect(decision.action).toBe('refuse');
			expect(decision.action === 'refuse' && decision.message.length).toBeGreaterThan(10);
		}
	});

	it('confirms rather than refuses an uncached row with the toggle on', () => {
		// The one case that is neither: it asks, and that is the point of asking.
		const uncached = row({ state: 'uncached', reachable: false });
		expect(decideAdd(uncached, ALL_ON, NONE)).toEqual({ action: 'confirm' });
	});
});

describe('confirmSummary', () => {
	it('states a season pack in GB, not in MB wearing a GB label', () => {
		// The regression this whole block exists for: the grid said 58.59 GB and
		// the dialog said 62000.00 GB for the same row.
		expect(confirmSummary(row({ totalSizeMb: 60000 }))).toContain('58.59 GB');
		expect(confirmSummary(row({ totalSizeMb: 60000 }))).not.toContain('60000');
	});

	it('agrees with the grid about the same row', () => {
		const season = row({ totalSizeMb: 62000, biggestVideoMb: 60000 });
		expect(confirmSummary(season)).toContain(formatSize(season.totalSizeMb));
	});

	it('keeps MB for a release too small to be worth converting', () => {
		expect(confirmSummary(row({ totalSizeMb: 700 }))).toContain('700 MB');
	});

	it('shows the video count only where Torbox actually listed files', () => {
		expect(confirmSummary(row({ state: 'instant', videoCount: 12 }))).toContain('12 video');
		// Uncached: zero because nothing was counted, not because there is no video.
		expect(confirmSummary(row({ state: 'uncached', videoCount: 0 }))).not.toContain('video');
	});

	it('truncates the hash to the first twelve characters', () => {
		expect(confirmSummary(row())).toContain(`${'a'.repeat(12)}…`);
	});
});
