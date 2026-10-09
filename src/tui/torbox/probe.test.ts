import { parseCheckCached, probeTorBox } from '@/tui/torbox/probe';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.join(process.cwd(), 'src', 'test', 'fixtures');

/**
 * A recorded Torbox response, normalised.
 *
 * The fixture convention is not uniform: the `checkcached` recordings are the raw
 * envelope, while the `torbox/*` ones are wrapped as `{ status, body }` (see
 * `torbox/user-me-bad-token-2026-09-24.json`). Both are unwrapped here rather than
 * assumed, because assuming one shape fails as an empty result rather than as an
 * error — which is exactly the failure mode `unknown` exists to avoid.
 */
const recorded = (rel: string): { status: number; body: unknown } => {
	const raw = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf-8')) as unknown;
	if (raw && typeof raw === 'object' && 'body' in raw && 'status' in raw) {
		return raw as { status: number; body: unknown };
	}
	return { status: 200, body: raw };
};

const SPIDERMAN = 'instantChecks/spiderman3-uhd-torbox-checkcached.json';
const SPIDERMAN_HASH = '732d1e50abda37be16d3f7d520c1374f4424be5c';
const BASE = 'https://api.torbox.app';

function stubTorbox(handler: (body: unknown) => { status: number; body: unknown }) {
	const calls: { hashes: string[]; url: string }[] = [];
	const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const hashes = JSON.parse(String(init?.body ?? '{}')).hashes as string[];
		calls.push({ hashes, url });
		const reply = handler(JSON.parse(String(init?.body ?? '{}')));
		return new Response(JSON.stringify(reply.body), {
			status: reply.status,
			headers: { 'content-type': 'application/json' },
		});
	});
	vi.stubGlobal('fetch', mock);
	return { mock, calls };
}

const okWith = (body: unknown) => () => ({ status: 200, body });

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('parseCheckCached', () => {
	it('reads the object-keyed shape the client asks for', () => {
		const result = parseCheckCached(recorded(SPIDERMAN).body);
		expect([...result.cached]).toEqual([SPIDERMAN_HASH]);
		expect(result.files.get(SPIDERMAN_HASH)).toHaveLength(1);
	});

	it('reads the array shape the format=list response arrives in', () => {
		// Recorded response, same endpoint, different `format`.
		const result = parseCheckCached(recorded('contentRequests/tb-checkcached-batch.json').body);
		expect([...result.cached]).toEqual(['90a7b57357ed0f2ae65ca39336b3bd923684413e']);
	});

	it('reports nothing cached for an empty data array', () => {
		expect(
			parseCheckCached(recorded('contentRequests/tb-checkcached-uncached.json').body).cached
				.size
		).toBe(0);
	});

	it('lowercases the hash it keys on', () => {
		const upper = SPIDERMAN_HASH.toUpperCase();
		const result = parseCheckCached({
			success: true,
			data: { [upper]: { hash: upper, files: [] } },
		});
		expect([...result.cached]).toEqual([SPIDERMAN_HASH]);
	});

	it('keeps a file id Torbox gave rather than its array position', () => {
		// Measured 2026-08-24: 50 of 52 files across four season packs had an id
		// that was not the position.
		const result = parseCheckCached({
			success: true,
			data: {
				abc: {
					hash: 'abc',
					files: [
						{ id: 41, name: 'a.mkv', size: 1 },
						{ id: 7, name: 'b.mkv', size: 2 },
					],
				},
			},
		});
		expect(result.files.get('abc')?.map((f) => f.id)).toEqual([41, 7]);
	});

	it('leaves an id undefined when Torbox omits one, never the position', () => {
		const result = parseCheckCached({
			success: true,
			data: { abc: { hash: 'abc', files: [{ name: 'a.mkv', size: 1 }] } },
		});
		expect(result.files.get('abc')?.[0].id).toBeUndefined();
	});

	it('survives a body that is not an envelope at all', () => {
		expect(parseCheckCached(null).cached.size).toBe(0);
		expect(parseCheckCached({}).cached.size).toBe(0);
	});
});

describe('probeTorBox', () => {
	it('asks for the object format with file listings', async () => {
		const { calls } = stubTorbox(okWith({ success: true, data: {} }));
		await probeTorBox('key', [SPIDERMAN_HASH], BASE);
		expect(calls[0].url).toBe(
			'https://api.torbox.app/v1/api/torrents/checkcached?format=object&list_files=true'
		);
	});

	it('sends the key as a bearer header and never in the URL', async () => {
		const { mock } = stubTorbox(okWith({ success: true, data: {} }));
		await probeTorBox('my-key', ['a'.repeat(40)], BASE);
		const [url, init] = mock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer my-key');
		expect(url).not.toContain('my-key');
	});

	it('chunks at one hundred hashes', async () => {
		const { calls } = stubTorbox(okWith({ success: true, data: {} }));
		const hashes = Array.from({ length: 250 }, (_, i) => String(i).padStart(40, '0'));
		await probeTorBox('key', hashes, BASE);
		expect(calls.map((c) => c.hashes.length)).toEqual([100, 100, 50]);
	});

	it('deduplicates and lowercases before sending', async () => {
		const { calls } = stubTorbox(okWith({ success: true, data: {} }));
		const hash = SPIDERMAN_HASH;
		await probeTorBox('key', [hash, hash.toUpperCase(), ` ${hash} `], BASE);
		expect(calls[0].hashes).toEqual([hash]);
	});

	it('marks a timed-out chunk unknown rather than uncached', async () => {
		// 219 of 369 board requests failed as `uncached` when the truth was that
		// nobody had asked Torbox.
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
		const result = await probeTorBox('key', ['a'.repeat(40)], BASE);
		expect([...result.unknown]).toEqual(['a'.repeat(40)]);
		expect(result.cached.size).toBe(0);
	});

	it('marks a 429 unknown and does not retry into it', async () => {
		const { mock } = stubTorbox(() => ({
			status: 429,
			body: { success: false, error: 'RATE_LIMIT' },
		}));
		const result = await probeTorBox('key', ['a'.repeat(40)], BASE);
		expect(result.unknown.size).toBe(1);
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it('marks a body without success unknown', async () => {
		stubTorbox(okWith({ data: { abc: { hash: 'abc' } } }));
		const result = await probeTorBox('key', ['abc'], BASE);
		expect([...result.unknown]).toEqual(['abc']);
		expect(result.cached.size).toBe(0);
	});

	it('keeps a good chunk when a later one fails', async () => {
		let call = 0;
		stubTorbox(() => {
			call += 1;
			return call === 1
				? {
						status: 200,
						body: { success: true, data: { abc: { hash: 'abc', files: [] } } },
					}
				: { status: 500, body: {} };
		});
		const hashes = Array.from({ length: 150 }, (_, i) => String(i).padStart(40, '0'));
		const result = await probeTorBox('key', hashes, BASE);
		expect(result.cached.has('abc')).toBe(true);
		expect(result.unknown.size).toBe(50);
	});

	it('reports a real recorded response end to end', async () => {
		stubTorbox(okWith(recorded(SPIDERMAN).body));
		const result = await probeTorBox('key', [SPIDERMAN_HASH], BASE);
		expect([...result.cached]).toEqual([SPIDERMAN_HASH]);
		expect(result.unknown.size).toBe(0);
		const [file] = result.files.get(SPIDERMAN_HASH) ?? [];
		expect(file.name).toContain('Spider-Man 3');
		expect(file.size).toBeGreaterThan(0);
	});

	it('tolerates a trailing slash on the API base', async () => {
		const { calls } = stubTorbox(okWith({ success: true, data: {} }));
		await probeTorBox('key', ['abc'], `${BASE}/`);
		expect(calls[0].url.startsWith('https://api.torbox.app/v1/')).toBe(true);
	});

	it('does not call Torbox for an empty hash list', async () => {
		const { mock } = stubTorbox(okWith({ success: true, data: {} }));
		await probeTorBox('key', [], BASE);
		expect(mock).not.toHaveBeenCalled();
	});
});
