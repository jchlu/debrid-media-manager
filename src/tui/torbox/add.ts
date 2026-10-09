import { toMagnetUri } from '@/utils/extractHashes';

/**
 * Creating a torrent on the Torbox account, and proving it landed.
 *
 * The parameter list is the interesting part. `allow_zip`, `seed` and
 * `add_only_if_cached` all exist on `createtorrent` and none of them is sent,
 * because each of them is a way to spend something the user did not ask to spend:
 *
 *  - `allow_zip` would let Torbox answer with one archive where a playable file
 *    was wanted. 122 of 283 BDMV torrents Torbox held were packed into a single
 *    `.zip` when measured on 2026-10-03 (`utils/instantChecks.ts:130`).
 *  - `add_only_if_cached` makes Torbox refuse the request outright rather than
 *    return an id, so a wrong guess produces a failure with no explanation. The
 *    guard for that is in the grid, not here.
 *  - `seed` expresses a seeding preference the client has none of.
 *
 * DMM passes none of them either (`utils/addMagnet.ts:724-767`). Sending nothing
 * is the same behaviour, and the absence is asserted by a test because a
 * forgotten parameter is a safety regression rather than a missing feature.
 */

/** One second between adds, matching `TB_BATCH_MAGNET_DELAY` in
 *  `utils/addMagnet.ts:149`. */
const ADD_PACING_MS = 1000;
const TIMEOUT_MS = 15_000;

export type AddOutcome =
	| {
			ok: true;
			/** Torbox's own id, which `mylist` is then checked against. */
			torrentId?: number;
			/** True when Torbox queued rather than created, which is not a failure. */
			queued: boolean;
			/** Present when the create succeeded but `mylist` did not confirm it. */
			verificationWarning?: string;
	  }
	| { ok: false; message: string; retryAfterSeconds?: number };

type CreateBody = {
	success?: unknown;
	error?: unknown;
	detail?: unknown;
	data?: { torrent_id?: unknown; queued_id?: unknown };
};

/**
 * Creates the torrent and, when asked, confirms it appears in `mylist`.
 *
 * Success is `success === true` **and** an id of some kind. A response with
 * neither `torrent_id` nor `queued_id` is a real observed Torbox answer, and DMM
 * reports it as "added without an ID" (`utils/addMagnet.ts:742-745`) — treating it
 * as success would leave the user looking at the Torbox dashboard for a torrent
 * that is not there.
 */
export async function addTorrent(
	apiKey: string,
	hash: string,
	{ apiBase, verify = true }: { apiBase: string; verify?: boolean }
): Promise<AddOutcome> {
	const base = apiBase.replace(/\/+$/, '');

	const form = new FormData();
	// Torbox requires a full magnet URI, not a bare infohash.
	form.append('magnet', toMagnetUri(hash));

	let res: Response;
	try {
		res = await fetch(`${base}/v1/api/torrents/createtorrent`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
			body: form,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (error) {
		return {
			ok: false,
			message: `Could not reach Torbox: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const body = (await res.json().catch(() => null)) as CreateBody | null;

	if (res.status === 429) {
		const header = Number(res.headers.get('retry-after'));
		return {
			ok: false,
			message: 'Torbox is rate-limiting. Wait for the countdown and try again.',
			retryAfterSeconds: Number.isFinite(header) && header > 0 ? header : undefined,
		};
	}
	// `createtorrent-plan-restricted-2026-09-23.json` is a real recording of this:
	// a free plan answers 403 here and nowhere earlier, so a client that does not
	// check up front discovers it at the worst possible moment.
	if (res.status === 403 && body?.error === 'PLAN_RESTRICTED_FEATURE') {
		return {
			ok: false,
			message:
				'Torbox refused: this account is on the free plan, which has no API access. Adding needs a paid plan.',
		};
	}

	const errorCode = typeof body?.error === 'string' ? body.error : undefined;
	const detail = typeof body?.detail === 'string' ? body.detail : '';

	if (!res.ok || body?.success !== true) {
		return {
			ok: false,
			message:
				detail || `Torbox answered ${res.status}${errorCode ? ` (${errorCode})` : ''}.`,
		};
	}

	const torrentId = typeof body.data?.torrent_id === 'number' ? body.data.torrent_id : undefined;
	const queuedId = typeof body.data?.queued_id === 'number' ? body.data.queued_id : undefined;
	if (torrentId === undefined && queuedId === undefined) {
		return {
			ok: false,
			message:
				'Torbox reported success but returned no torrent id, so nothing can be confirmed on the account. ' +
				'Check the Torbox dashboard before adding anything else.',
		};
	}

	const id = torrentId ?? queuedId;
	if (!verify) {
		return { ok: true, torrentId: id, queued: torrentId === undefined };
	}

	const confirmed = await isOnAccount(base, apiKey, hash);
	return {
		ok: true,
		torrentId: id,
		queued: torrentId === undefined,
		// A warning, never a failure: the create already succeeded, and reporting
		// it as an error would be a lie about what happened.
		verificationWarning: confirmed
			? undefined
			: 'Added, but it did not appear in the Torbox list within a few seconds. It may still be settling.',
	};
}

/**
 * Whether the account's own list holds this hash.
 *
 * A read, and deliberately not load-bearing: an account with a very large list
 * makes this slow, which is why `verifyAdds` exists to switch it off.
 */
async function isOnAccount(base: string, apiKey: string, hash: string): Promise<boolean> {
	try {
		const res = await fetch(`${base}/v1/api/torrents/mylist?bypass_cache=true`, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
		if (!res.ok || !body?.data) return false;
		const wanted = hash.toLowerCase();
		const rows = Array.isArray(body.data)
			? body.data
			: Object.values(body.data as Record<string, unknown>);
		return rows.some((row) => {
			const value = (row as { hash?: unknown })?.hash;
			return typeof value === 'string' && value.toLowerCase() === wanted;
		});
	} catch {
		return false;
	}
}

let lastAddAt = 0;
let tail: Promise<unknown> = Promise.resolve();

/**
 * Serialises adds a second apart.
 *
 * A queue rather than a per-call delay, because a per-call delay reads
 * `lastAddAt` on entry — so two adds launched together both see the same stale
 * value, both conclude there is no need to wait, and both fire at once. That is
 * exactly the case Torbox's own limit exists to refuse. The serial queue is the
 * same shape as `createReleaseQueue` in `dmm/releases.ts`, for the same reason.
 */
export async function pacedAdd<T>(fn: () => Promise<T>): Promise<T> {
	const previous = tail;
	let release!: () => void;
	tail = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		const wait = lastAddAt + ADD_PACING_MS - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		return await fn();
	} finally {
		lastAddAt = Date.now();
		// Released even when the add throws, or every later one waits behind a
		// promise that never settles.
		release();
	}
}
