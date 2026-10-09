import type { ProbeFile } from '@/tui/torbox/probe';
import { isVideo } from '@/utils/selectable';

/**
 * What the grid draws, and the two rules that keep a stray keypress from costing
 * Torbox points.
 *
 * The guards live here rather than in the UI on purpose. This is the only layer
 * that knows both whether Torbox holds a release *and* whether that release is an
 * archive to unpack, so a check placed in a component would be one refactor away
 * from being bypassed. `reachable` is the single answer to "may this row be
 * added", and nothing else answers that question.
 */

export type TbState =
	/** Torbox holds it and the listing has a playable video. Addable. */
	| 'instant'
	/** Torbox holds it as one archive. Nothing to play. */
	| 'archive'
	/** Torbox does not hold it. Adding spends points and bandwidth. */
	| 'uncached'
	/** Torbox gave no verdict. Treated as neither cached nor uncached. */
	| 'unknown';

export type GridRow = {
	hash: string;
	title: string;
	/** Lowercased, so filter and lookup need no case handling. */
	state: TbState;
	/** True when adding needs a confirmation step rather than happening at once. */
	requiresConfirm: boolean;
	/** True when the row may be added at all. The guard, in one place. */
	reachable: boolean;
	/** Video files in Torbox's listing. Zero for uncached and unknown. */
	videoCount: number;
	/** MB. Total across the listing, or the scraped row's own total. */
	totalSizeMb: number;
	/** MB. Biggest video, which is what a movie is ranked on. */
	biggestVideoMb: number;
	medianVideoMb: number;
	meanVideoMb: number;
	/** Set once an add has succeeded, so the grid can mark it. */
	added?: boolean;
};

/** Files that end in an archive extension. Mirrors `isArchive` in
 *  `utils/instantChecks.ts:80`. */
export const isArchiveName = (filename: string): boolean =>
	/\.(zip|rar|7z|r\d{2})$/i.test(filename);

export type FileStats = {
	videoCount: number;
	biggestVideoMb: number;
	medianVideoMb: number;
	meanVideoMb: number;
};

const EMPTY_STATS: FileStats = {
	videoCount: 0,
	biggestVideoMb: 0,
	medianVideoMb: 0,
	meanVideoMb: 0,
};

/**
 * Sizes of the playable files in a listing, in MB.
 *
 * Video detection reuses `utils/selectable.ts`, which is pure and imports
 * nothing — verified importable in a Node process before this module existed. So
 * a `/rarbg` directory, a `.sample` and a `.trailer` are excluded exactly as the
 * browser excludes them: those files are large, and without the exclusion every
 * season pack reads as gigabytes of video it does not contain.
 */
export function fileStats(files: ProbeFile[]): FileStats {
	const sizes = files
		.filter((f) => isVideo({ path: f.name }))
		.map((f) => f.size / 1024 / 1024)
		.sort((a, b) => a - b);
	if (sizes.length === 0) return EMPTY_STATS;

	const mid = Math.floor(sizes.length / 2);
	return {
		videoCount: sizes.length,
		biggestVideoMb: sizes[sizes.length - 1],
		medianVideoMb: sizes.length % 2 !== 0 ? sizes[mid] : (sizes[mid - 1] + sizes[mid]) / 2,
		meanVideoMb: sizes.reduce((total, size) => total + size, 0) / sizes.length,
	};
}

export type StateInput = {
	cached: boolean;
	unknown: boolean;
	files: ProbeFile[];
	/** True when a listing with no video holds an archive. */
	hasArchive: boolean;
};

/**
 * Cached, archive, uncached, or unknown — in that order of precedence.
 *
 * `unknown` is checked before `uncached` because a row Torbox did not answer for
 * must never read as one it refused.
 */
export function tbState({ cached, unknown, files, hasArchive }: StateInput): TbState {
	if (cached) {
		const playable = files.some((f) => !isArchiveName(f.name));
		return playable ? 'instant' : 'archive';
	}
	if (unknown) return 'unknown';
	return 'uncached';
}

/**
 * Whether a row may be added without a confirmation step.
 *
 * The default posture: cached, not an archive, and no add already recorded. An
 * unknown row is deliberately not addable without confirming, since it may well
 * be cached and the probe simply failed to say so.
 */
export function canAdd(state: TbState): boolean {
	return state === 'instant';
}
