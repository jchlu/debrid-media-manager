import { createChallengeClient } from '@/tui/dmm/challenge';
import { DmmError, dmmGet, readJson, type ScrapeStatus } from '@/tui/dmm/client';

/**
 * The release grid, and the one rate limit in this client that is a real limit.
 *
 * `/api/torrents/*` is capped at one request per two seconds **per IP**
 * (`src/services/rateLimit/configs.ts:25`). DMM runs natively on the same host
 * as this client, so the loopback requests here share a counter with anything
 * else on the box hitting that endpoint. The floor is 2.5 s rather than 2.0 s
 * because the budget is a fixed window and sitting half a second under the line
 * is cheaper than a 429 that surfaces to the user as an empty grid with no
 * explanation.
 */

const MIN_INTERVAL_MS = 2500;

/** What the endpoint stores and returns: `{ hash, title, fileSize }`. */
export type Release = {
	hash: string;
	title: string;
	/** MB, as DMM reports it. Zero for rows a scraper could not size. */
	fileSize: number;
};

type ReleasesBody = { results?: unknown };

export type ReleasesResult =
	| { state: 'ok'; releases: Release[] }
	/** The title is not in the scraped table yet. A state, not a failure. */
	| { state: 'not-scraped'; status: ScrapeStatus };

function isRelease(value: unknown): value is Release {
	if (typeof value !== 'object' || value === null) return false;
	const row = value as Record<string, unknown>;
	// `isUsableHash` in the browser drops degenerate hashes before they reach a
	// page; the same test here stops them reaching a magnet.
	return typeof row.hash === 'string' && /^[a-f0-9]{40}$/i.test(row.hash.trim());
}

export function normaliseReleases(body: unknown): Release[] {
	if (typeof body !== 'object' || body === null) return [];
	const { results } = body as ReleasesBody;
	if (!Array.isArray(results)) return [];
	const seen = new Set<string>();
	const releases: Release[] = [];
	for (const row of results) {
		if (!isRelease(row)) continue;
		const hash = row.hash.trim().toLowerCase();
		// `flattenAndRemoveDuplicates` keys on hash and keeps the first, so a
		// duplicate is not an error — it is one row shown twice.
		if (seen.has(hash)) continue;
		seen.add(hash);
		releases.push({
			hash,
			title: typeof row.title === 'string' ? row.title : '',
			fileSize:
				typeof row.fileSize === 'number' && Number.isFinite(row.fileSize)
					? row.fileSize
					: 0,
		});
	}
	return releases;
}

/**
 * Serialises every `/api/torrents/*` call behind one queue.
 *
 * Serial rather than rate-limited-per-call: the limit is one request per window
 * per IP, so two calls launched together are exactly the case it refuses. A
 * queue also makes the floor testable with fake timers, which a per-call
 * `setTimeout` is not.
 */
export function createReleaseQueue(minIntervalMs: number = MIN_INTERVAL_MS) {
	let lastStartedAt = 0;
	let tail: Promise<unknown> = Promise.resolve();

	async function paced<T>(fn: () => Promise<T>): Promise<T> {
		const previous = tail;
		let release!: () => void;
		tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			const wait = lastStartedAt + minIntervalMs - Date.now();
			if (wait > 0) await new Promise((r) => setTimeout(r, wait));
			lastStartedAt = Date.now();
			return await fn();
		} finally {
			release();
		}
	}

	return { paced };
}

function parseNotScraped(res: Response): DmmError | null {
	if (res.status !== 204) return null;
	const header = res.headers.get('status');
	if (header === 'requested' || header === 'processing') {
		return new DmmError('not-scraped', `DMM has not scraped this title yet (${header}).`);
	}
	return new DmmError('not-scraped', 'DMM answered 204 with no status header.');
}

async function fetchReleases(baseUrl: string, path: string): Promise<ReleasesResult> {
	const res = await dmmGet(baseUrl, path);
	const notScraped = parseNotScraped(res);
	if (notScraped) throw notScraped;
	if (!res.ok) {
		throw new DmmError('server', `DMM answered ${res.status} for ${path}.`);
	}
	return { state: 'ok', releases: normaliseReleases(await readJson<ReleasesBody>(res, baseUrl)) };
}

export function createReleasesClient(
	baseUrl: string,
	challengeClient = createChallengeClient(baseUrl)
) {
	const queue = createReleaseQueue();

	async function withChallenge(
		path: string,
		extra: Record<string, string>
	): Promise<ReleasesResult> {
		const challenge = await challengeClient.get();
		const query = new URLSearchParams({
			dmmProblemKey: challenge.token,
			solution: challenge.hash,
			...extra,
		});
		return queue.paced(() => fetchReleases(baseUrl, `${path}?${query.toString()}`));
	}

	return {
		/** Releases for a movie. */
		movie(imdbid: string, page = 0): Promise<ReleasesResult> {
			return withChallenge('/api/torrents/movie', { imdbId: imdbid, page: String(page) });
		},
		/** Releases for one season. `seasonNum` is required server-side. */
		season(imdbid: string, seasonNum: number, page = 0): Promise<ReleasesResult> {
			return withChallenge('/api/torrents/tv', {
				imdbId: imdbid,
				seasonNum: String(seasonNum),
				page: String(page),
			});
		},
	};
}
