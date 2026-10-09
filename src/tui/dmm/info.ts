import { dmmGet, readJson } from '@/tui/dmm/client';
import { getEpisodeCountLabel, getExpectedEpisodeCount } from '@/utils/episodeUtils';
import { airedEpisodeCount } from '@/utils/seasonPacks';

/**
 * What a title is called, and how many episodes of a season actually exist.
 *
 * Only the second part earns its keep. `Complete (8/8)` has to mean "all eight
 * that have aired", not "all eight that exist" — a season currently airing is
 * counted by cinemeta before its later episodes do, so every pack would read
 * incomplete and every add would look like a gap. `airedEpisodeCount` in
 * `src/utils/seasonPacks.ts:118-133` is the existing answer and is reused rather
 * than reinvented.
 */

export type MediaInfo = {
	imdbid: string;
	title: string;
	year?: number;
	/** A show's season numbers mapped to their episode counts, e.g. `{ 1: 10 }`. */
	seasonEpisodeCounts?: Record<number, number>;
	/** Null rather than a partial shape when unreadable, so `airedEpisodeCount`'s
	 *  own contract is satisfied without a cast at the call site. */
	lastEpisodeToAir?: { season_number: number; episode_number: number } | null;
};

type InfoBody = {
	title?: unknown;
	year?: unknown;
	season_episode_counts?: unknown;
	last_episode_to_air?: unknown;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * cinemeta's counts arrive keyed by string. Non-numeric or empty entries are
 * dropped rather than becoming `NaN`, which `getExpectedEpisodeCount` would then
 * pass straight into a label.
 */
function readEpisodeCounts(value: unknown): Record<number, number> | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const counts: Record<number, number> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		const season = Number(key);
		const episodes = Number(raw);
		if (Number.isInteger(season) && Number.isFinite(episodes) && episodes > 0) {
			counts[season] = Math.round(episodes);
		}
	}
	return Object.keys(counts).length ? counts : undefined;
}

function readLastEpisodeToAir(value: unknown): MediaInfo['lastEpisodeToAir'] {
	if (typeof value !== 'object' || value === null) return null;
	const row = value as Record<string, unknown>;
	const season = Number(row.season_number);
	const episode = Number(row.episode_number);
	if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
	return { season_number: season, episode_number: episode };
}

async function fetchInfo(
	baseUrl: string,
	kind: 'movie' | 'show',
	imdbid: string
): Promise<MediaInfo> {
	const res = await dmmGet(baseUrl, `/api/info/${kind}?imdbid=${encodeURIComponent(imdbid)}`);
	if (!res.ok) {
		throw new Error(`DMM answered ${res.status} for /api/info/${kind}?imdbid=${imdbid}.`);
	}
	const body = await readJson<InfoBody>(res, baseUrl);
	const info: MediaInfo = { imdbid, title: asString(body.title) };
	if (typeof body.year === 'number' && Number.isFinite(body.year)) info.year = body.year;
	if (kind === 'show') {
		info.seasonEpisodeCounts = readEpisodeCounts(body.season_episode_counts);
		info.lastEpisodeToAir = readLastEpisodeToAir(body.last_episode_to_air);
	}
	return info;
}

export const fetchMovieInfo = (baseUrl: string, imdbid: string): Promise<MediaInfo> =>
	fetchInfo(baseUrl, 'movie', imdbid);

export const fetchShowInfo = (baseUrl: string, imdbid: string): Promise<MediaInfo> =>
	fetchInfo(baseUrl, 'show', imdbid);

/**
 * How many episodes of `season` there are to find, which is not the same as how
 * many the season lists.
 *
 * Falls back to 13, matching `getExpectedEpisodeCount`, because a season with no
 * count from any provider should still render a label rather than `Complete
 * (0/0)`.
 */
export function expectedEpisodes(info: MediaInfo, seasonNum: number): number {
	const listed = getExpectedEpisodeCount(String(seasonNum), info.seasonEpisodeCounts ?? {});
	return airedEpisodeCount(seasonNum, listed, info.lastEpisodeToAir);
}

/** `Complete (8/8)`, `Incomplete (5/8)`, `Single`, or `With extras (10/8)`. */
export function episodeLabel(videoCount: number, expected: number): string {
	return getEpisodeCountLabel(videoCount, expected);
}
