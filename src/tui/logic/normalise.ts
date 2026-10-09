import type { Release } from '@/tui/dmm/releases';
import { canAdd, fileStats, isArchiveName, tbState, type GridRow } from '@/tui/logic/types';
import type { ProbeResult } from '@/tui/torbox/probe';

/**
 * Joining a scraped release to a Torbox verdict.
 *
 * This is where the client's central claim is either true or false: one probe
 * supplies both availability and every size the grid draws, so no second request
 * is needed and a row is never half-known.
 *
 * The two guards are applied here, after the verdict is known and before a row is
 * ever rendered. `visibleRows` is the only thing the UI should call to decide
 * what it may show, and `reachable` on a row is the only thing it should call to
 * decide whether `a` is allowed.
 */

export type GuardOptions = {
	showUncached: boolean;
	showArchiveOnly: boolean;
};

/** One scraped release plus the verdict Torbox gave it. */
export function toGridRow(release: Release, probe: ProbeResult): GridRow {
	const hash = release.hash.toLowerCase();
	const cached = probe.cached.has(hash);
	const unknown = probe.unknown.has(hash);
	const files = probe.files.get(hash) ?? [];
	const stats = fileStats(files);
	const hasArchive = files.length > 0 && files.every((f) => isArchiveName(f.name));
	const state = tbState({ cached, unknown, files, hasArchive });

	// A cached row's total is the listing's own size, which Torbox reports
	// exactly. An uncached row has no listing, so the scraped total stands.
	const listedTotal = files.reduce((total, f) => total + f.size, 0) / 1024 / 1024;

	return {
		hash,
		title: release.title,
		state,
		requiresConfirm: state !== 'instant',
		// Deliberately not `canAdd(state)`: a confirm step is a feature, but an
		// unknown row is one whose verdict failed, and the default grid has no
		// business offering it at all.
		reachable: canAdd(state),
		videoCount: stats.videoCount,
		totalSizeMb: cached && listedTotal > 0 ? listedTotal : release.fileSize,
		biggestVideoMb: stats.biggestVideoMb,
		medianVideoMb: stats.medianVideoMb,
		meanVideoMb: stats.meanVideoMb,
	};
}

export function toGridRows(releases: Release[], probe: ProbeResult): GridRow[] {
	return releases.map((release) => toGridRow(release, probe));
}

/**
 * The rows the grid may show, and — the property worth stating plainly — which
 * of them may be added.
 *
 * Cached first, then biggest watched file; uncached rows follow, biggest total
 * first. That asymmetry is DMM's own (`utils/results.tsx:100-117`): a cached row
 * is one you can play now, so it ranks on the file you would actually watch,
 * while an uncached row has no per-file breakdown and ranks on the total.
 */
export function visibleRows(rows: GridRow[], guards: GuardOptions): GridRow[] {
	const shown = rows.filter((row) => {
		if (row.state === 'uncached' && !guards.showUncached) return false;
		if (row.state === 'archive' && !guards.showArchiveOnly) return false;
		if (row.state === 'unknown') return false;
		return true;
	});

	const rank = (row: GridRow): number =>
		row.state === 'instant' ? row.biggestVideoMb || row.totalSizeMb : row.totalSizeMb;

	return [...shown].sort((a, b) => {
		// `unknown` never reaches here, so this only separates instant from the
		// rest.
		const aInstant = a.state === 'instant';
		const bInstant = b.state === 'instant';
		if (aInstant !== bInstant) return aInstant ? -1 : 1;
		const bySize = rank(b) - rank(a);
		if (bySize !== 0) return bySize;
		return a.hash.localeCompare(b.hash);
	});
}

/**
 * Whether a row may be added right now, given the guards.
 *
 * A separate function from `reachable` on the row because the toggles live here:
 * with `showUncached` on, an uncached row is visible but still costs points, and
 * with it off the row should not be visible in the first place.
 */
export function mayAdd(row: GridRow, guards: GuardOptions): boolean {
	switch (row.state) {
		case 'instant':
			return true;
		case 'archive':
			// Adding an archive yields something to unpack rather than something
			// to play, which is never wanted here — so this stays refused even
			// with archives revealed.
			return false;
		case 'uncached':
			return guards.showUncached;
		case 'unknown':
			return false;
	}
}
