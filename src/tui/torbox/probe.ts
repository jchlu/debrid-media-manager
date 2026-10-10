/**
 * Which releases Torbox can serve right now, and what is inside each one.
 *
 * `format=object&list_files=true` rather than the `format=list&list_files=false`
 * that `src/utils/torboxCache.ts` asks for, because this client needs the file
 * listing as well as the verdict. One probe answers both: `videoCount`,
 * `noVideos`, `archiveOnly` and every size statistic are read off the same
 * response, so a second request would buy nothing.
 *
 * Three properties of the endpoint shape the code below, and each has a test:
 *
 *  - **The answer is hits only.** A miss is an absent key, never `false`, so
 *    membership is tested against a Set and nothing assumes a positional
 *    line-up.
 *  - **A failure is `unknown`, not `uncached`.** `utils/torboxCache.ts:1-7`
 *    records why this is worth being pedantic about: 219 of 369 requests on the
 *    board had failed on the uploader as `uncached`, when the truth was that
 *    nobody had asked Torbox at all. Marking unknown rows uncached would hand
 *    back an empty grid labelled "Torbox does not have any of this".
 *  - **A file id is not an array position.** Measured 2026-08-24: 50 of 52 files
 *    across four season packs mismatched (`utils/instantChecks.ts:343-347`).
 */

import { CHECKCACHED_CHUNK } from '@/utils/torboxCache';

/**
 * Per-chunk timeout, matching `TIMEOUT_MS` in `utils/torboxCache.ts:11`.
 *
 * Declared here rather than imported because that one is module-private, and
 * importing a name a module does not export yields `undefined` at runtime rather
 * than an error — which silently turns every chunk into an immediate timeout.
 */
const TIMEOUT_MS = 8000;

/** One file as Torbox lists it. `id` is Torbox's own and is read explicitly. */
export type ProbeFile = {
	id: number | undefined;
	name: string;
	size: number;
};

export type ProbeResult = {
	/** Lowercased infohashes Torbox holds. Hits only. */
	cached: Set<string>;
	/** Hashes Torbox gave no verdict on: a timeout, a 429, a body without success. */
	unknown: Set<string>;
	/** Per-hash file listings, keyed by lowercase infohash. */
	files: Map<string, ProbeFile[]>;
};

type RawFile = { id?: unknown; name?: unknown; size?: unknown };
type RawEntry = { hash?: unknown; files?: unknown };

const asName = (value: unknown): string => (typeof value === 'string' ? value : '');

const toProbeFile = (raw: RawFile): ProbeFile => ({
	// Never falls back to the array position. The caller passes the raw `id`.
	id: typeof raw.id === 'number' ? raw.id : undefined,
	name: asName(raw.name),
	size: typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : 0,
});

/**
 * Reads both shapes `data` arrives in.
 *
 * `format=object` keys `data` by infohash; the recorded `format=list` response in
 * `tb-checkcached-batch.json` is an array with `hash` on each entry. Asking for
 * one format is not a guarantee of getting it, so both are read — the same
 * tolerance `utils/torboxCache.ts:52-54` applies.
 */
function readEntries(data: unknown): [string | undefined, RawEntry][] {
	if (Array.isArray(data)) return (data as RawEntry[]).map((entry) => [undefined, entry]);
	if (typeof data === 'object' && data !== null) {
		return Object.entries(data) as [string, RawEntry][];
	}
	return [];
}

export function parseCheckCached(body: unknown): ProbeResult {
	const cached = new Set<string>();
	const files = new Map<string, ProbeFile[]>();
	const envelope = body as { data?: unknown; success?: unknown };
	for (const [key, entry] of readEntries(envelope?.data)) {
		// In the object-keyed shape the key *is* the infohash; `hash` on the entry
		// is a redundant copy. Preferring the key means a response that omits the
		// copy still resolves — and a key that disagrees with a stale copy wins,
		// since the key is what was looked up.
		const fromKey = typeof key === 'string' ? key.toLowerCase() : '';
		const fromEntry = typeof entry?.hash === 'string' ? entry.hash.toLowerCase() : '';
		const hash = fromKey || fromEntry;
		if (!hash) continue;
		cached.add(hash);
		const listing = Array.isArray(entry.files) ? (entry.files as RawFile[]) : [];
		files.set(hash, listing.map(toProbeFile));
	}
	return { cached, unknown: new Set(), files };
}

export async function probeTorBox(
	apiKey: string,
	hashes: string[],
	apiBase: string
): Promise<ProbeResult> {
	const base = apiBase.replace(/\/+$/, '');
	const wanted = [...new Set(hashes.map((h) => h.trim().toLowerCase()).filter(Boolean))];
	const cached = new Set<string>();
	const unknown = new Set<string>();
	const files = new Map<string, ProbeFile[]>();

	for (let i = 0; i < wanted.length; i += CHECKCACHED_CHUNK) {
		const chunk = wanted.slice(i, i + CHECKCACHED_CHUNK);
		try {
			const res = await fetch(
				`${base}/v1/api/torrents/checkcached?format=object&list_files=true`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						Accept: 'application/json',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ hashes: chunk }),
					signal: AbortSignal.timeout(TIMEOUT_MS),
				}
			);
			const body = (await res.json().catch(() => null)) as { success?: unknown } | null;
			if (!res.ok || body?.success !== true) {
				// Unknown, not uncached. See the note at the top of this file.
				chunk.forEach((h) => unknown.add(h));
				continue;
			}
			const parsed = parseCheckCached(body);
			for (const hash of parsed.cached) cached.add(hash);
			for (const [hash, listing] of parsed.files) files.set(hash, listing);
		} catch {
			chunk.forEach((h) => unknown.add(h));
		}
	}

	return { cached, unknown, files };
}
