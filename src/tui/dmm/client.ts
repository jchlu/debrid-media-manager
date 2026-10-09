/**
 * Talking to a DMM instance over HTTP.
 *
 * Every failure the client can meet is turned into one `DmmError` here, so that
 * nothing downstream has to know whether a problem arrived as a status code, a
 * rejected fetch, or a body that would not parse — and, more usefully, so that
 * every message names the thing the reader can actually do about it.
 */

export type DmmErrorKind =
	| 'unreachable'
	| 'challenge-failed'
	| 'challenge-rejected'
	| 'not-scraped'
	| 'bad-request'
	| 'server';

export class DmmError extends Error {
	readonly kind: DmmErrorKind;
	/** Seconds to wait before retrying, when the server said so. */
	readonly retryAfterSeconds?: number;

	constructor(kind: DmmErrorKind, message: string, retryAfterSeconds?: number) {
		super(message);
		this.name = 'DmmError';
		this.kind = kind;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/**
 * What `/api/torrents/*` answers with instead of a body when the title has not
 * been scraped yet. This is a state, not an error: the browser renders it as
 * "Looking for torrents in the dark web"
 * (`src/pages/movie/[imdbid]/index.tsx:1191-1199`).
 *
 * An empty *page* only means "never scraped" when nothing narrowed the query —
 * later pages run out by design. The caller decides; see `releases.ts`.
 */
export type ScrapeStatus = 'requested' | 'processing';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * A GET against one DMM route.
 *
 * A bare `fetch` rather than `axios`, which this repo also uses: axios brings a
 * global instance, interceptors and a body-transforming default that would each
 * need undoing, and the only things wanted here are a timeout and a normalised
 * error. `AbortSignal.timeout` covers the case where DMM accepts the connection
 * and then goes quiet, which is how a scrape backlog presents.
 */
export async function dmmGet(
	baseUrl: string,
	path: string,
	{ timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<Response> {
	const url = `${baseUrl}${path}`;
	let res: Response;
	try {
		res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw new DmmError(
			'unreachable',
			`Could not reach DMM at ${baseUrl}. Is it running, and is dmmBaseUrl right? (${
				error instanceof Error ? error.message : String(error)
			})`
		);
	}

	// Named before it is interpreted as anything else, because both of its other
	// meanings are handled by the caller.
	if (res.status === 429) {
		const header = Number(res.headers.get('retry-after'));
		throw new DmmError(
			'server',
			'DMM is rate-limiting this address. Waiting before the next request.',
			Number.isFinite(header) && header > 0 ? header : undefined
		);
	}

	return res;
}

export async function readJson<T>(res: Response, baseUrl: string): Promise<T> {
	try {
		return (await res.json()) as T;
	} catch {
		throw new DmmError(
			'server',
			`DMM answered ${res.status} with a body that is not JSON. Check that ${baseUrl} points at DMM and not at another service.`
		);
	}
}
