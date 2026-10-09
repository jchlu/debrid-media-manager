import { DmmError, dmmGet, readJson } from '@/tui/dmm/client';

/**
 * The `dmmProblemKey` / `solution` pair every `/api/torrents/*` call must carry.
 *
 * This is the specific thing that makes the search path browser-shaped. The
 * signing key used to be a constant inside `utils/token.ts`, so it shipped in the
 * browser bundle and anyone could mint a valid token offline; signing moved
 * server-side into `GET /api/challenge` and a client now has to ask for one
 * (`src/utils/token.ts:4-9`, `src/pages/api/challenge.ts:10-13`). A terminal client
 * cannot mint one itself, which is why it fetches this first.
 */

/**
 * Well under the server's five-minute TTL, so a token handed out here still has
 * a wide margin when the request carrying it lands. Holding it for the near-full
 * TTL would issue a token with seconds to live. Matches `TOKEN_REUSE_MS` in
 * `src/utils/token.ts:19`.
 */
const REUSE_MS = 2 * 60 * 1000;

export type Challenge = { token: string; hash: string };

type ChallengeBody = { token?: unknown; hash?: unknown; error?: unknown };

type CacheEntry = { challenge: Challenge; at: number };

/**
 * A challenge cache bound to one DMM instance.
 *
 * A factory rather than module state, because the cache belongs to a base URL:
 * module-level state would serve one instance's token to another, and would leak
 * between tests.
 */
export function createChallengeClient(baseUrl: string, now: () => number = Date.now) {
	let cached: CacheEntry | null = null;
	let inFlight: Promise<Challenge> | null = null;

	async function mint(): Promise<Challenge> {
		const res = await dmmGet(baseUrl, '/api/challenge');
		const body = await readJson<ChallengeBody>(res, baseUrl);

		// Named because it is the single most likely misconfiguration: the endpoint
		// answers 500 with a generic message when the signing secret is unset, and
		// the generic message is not obviously about an environment variable.
		//
		// The variable's own name is deliberately not spelled out. A test asserts
		// that it appears nowhere outside the two server modules that may read it
		// (`src/utils/problemToken.bundleSafety.test.ts`), so that a future edit
		// cannot quietly start reading the secret from a client module. Pointing at
		// the .env.example instead keeps the message actionable without putting the
		// identifier in a file that ships to clients.
		if (res.status === 500 && body.error) {
			throw new DmmError(
				'challenge-failed',
				`DMM could not mint an availability token: ${String(body.error)}. ` +
					'The signing secret for availability tokens is unset or wrong on the DMM host — ' +
					'see the .env.example that ships with DMM.'
			);
		}
		if (!res.ok) {
			throw new DmmError(
				'challenge-failed',
				`DMM answered ${res.status} when asked for an availability token.`
			);
		}
		if (typeof body.token !== 'string' || typeof body.hash !== 'string') {
			throw new DmmError(
				'challenge-failed',
				'DMM returned a malformed availability token. Is dmmBaseUrl pointing at DMM?'
			);
		}

		const challenge: Challenge = { token: body.token, hash: body.hash };
		cached = { challenge, at: now() };
		return challenge;
	}

	return {
		/**
		 * A token/signature pair to send as `dmmProblemKey` and `solution`.
		 *
		 * Concurrent callers share one in-flight request, so a client that starts
		 * several requests at once costs one mint rather than one each.
		 */
		async get(): Promise<Challenge> {
			if (cached && now() - cached.at < REUSE_MS) return cached.challenge;
			if (!inFlight) {
				inFlight = mint().finally(() => {
					inFlight = null;
				});
			}
			return inFlight;
		},

		/** For tests. Drops the cached pair and any in-flight mint. */
		reset(): void {
			cached = null;
			inFlight = null;
		},
	};
}
