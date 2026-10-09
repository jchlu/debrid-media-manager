import { addTorrent, pacedAdd } from '@/tui/torbox/add';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.join(process.cwd(), 'src', 'test', 'fixtures');
const HASH = '732d1e50abda37be16d3f7d520c1374f4424be5c';
const BASE = 'https://api.torbox.app';

/** A recorded `{status, body}` response, or a raw envelope unwrapped. */
const recorded = (rel: string): { status: number; body: unknown } => {
	const raw = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf-8')) as unknown;
	if (raw && typeof raw === 'object' && 'body' in raw && 'status' in raw) {
		return raw as { status: number; body: unknown };
	}
	return { status: 200, body: raw };
};

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

/** Answers by URL path, recording the requests made. */
function stubTorbox(handler: (url: string, init?: RequestInit) => Reply) {
	const sent: { url: string; init?: RequestInit }[] = [];
	const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		sent.push({ url, init });
		const { status, body, headers } = handler(url, init);
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json', ...(headers ?? {}) },
		});
	});
	vi.stubGlobal('fetch', mock);
	return { mock, sent };
}

const created = (id: unknown, queued = false) => ({
	status: 200,
	body: {
		success: true,
		error: null,
		detail: '',
		data: queued ? { queued_id: id } : { torrent_id: id },
	},
});

const onAccount = (present: boolean) => ({
	status: 200,
	body: { success: true, data: present ? [{ hash: HASH, id: 5 }] : [] },
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('addTorrent', () => {
	it('sends a magnet, not a bare hash', async () => {
		const { sent } = stubTorbox((url) =>
			url.includes('createtorrent') ? created(42) : onAccount(true)
		);
		await addTorrent('key', HASH, { apiBase: BASE });
		const body = sent[0].init?.body as FormData;
		expect(body.get('magnet')).toBe(`magnet:?xt=urn:btih:${HASH}`);
	});

	it('sends no allow_zip, no seed and no add_only_if_cached', async () => {
		// Each is a way to spend something not asked for. A forgotten safety
		// parameter is a regression, so its absence is asserted rather than assumed.
		const { sent } = stubTorbox((url) =>
			url.includes('createtorrent') ? created(42) : onAccount(true)
		);
		await addTorrent('key', HASH, { apiBase: BASE });
		const body = sent[0].init?.body as FormData;
		expect([...body.keys()]).toEqual(['magnet']);
	});

	it('reports a created torrent and confirms it on the account', async () => {
		stubTorbox((url) => (url.includes('createtorrent') ? created(42) : onAccount(true)));
		await expect(addTorrent('key', HASH, { apiBase: BASE })).resolves.toEqual({
			ok: true,
			torrentId: 42,
			queued: false,
			verificationWarning: undefined,
		});
	});

	it('treats a queued id as a success, not a failure', async () => {
		stubTorbox((url) => (url.includes('createtorrent') ? created(99, true) : onAccount(false)));
		const result = await addTorrent('key', HASH, { apiBase: BASE });
		expect(result).toMatchObject({ ok: true, torrentId: 99, queued: true });
	});

	it('refuses to call success when Torbox returns no id at all', async () => {
		// A real observed answer, which DMM reports as "added without an ID".
		// Calling it success would leave the user hunting the dashboard.
		stubTorbox(() => ({
			status: 200,
			body: { success: true, error: null, detail: '', data: {} },
		}));
		const result = await addTorrent('key', HASH, { apiBase: BASE, verify: false });
		expect(result).toMatchObject({ ok: false });
		expect(result.ok === false && result.message).toMatch(/no torrent id/);
	});

	it('names the free plan from a recorded refusal', async () => {
		stubTorbox(() => recorded('torbox/createtorrent-plan-restricted-2026-09-23.json'));
		const result = await addTorrent('key', HASH, { apiBase: BASE, verify: false });
		expect(result).toMatchObject({ ok: false });
		expect(result.ok === false && result.message).toMatch(/free plan/);
	});

	it('surfaces Retry-After on a 429 rather than retrying into it', async () => {
		const { mock } = stubTorbox(() => ({
			status: 429,
			body: { success: false, error: 'RATE_LIMIT' },
			headers: { 'retry-after': '7' },
		}));
		const result = await addTorrent('key', HASH, { apiBase: BASE });
		expect(result).toMatchObject({ ok: false, retryAfterSeconds: 7 });
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it('quotes Torbox detail when it refuses for another reason', async () => {
		stubTorbox(() => ({
			status: 400,
			body: {
				success: false,
				error: 'BAD_REQUEST',
				detail: 'That magnet is not acceptable.',
			},
		}));
		const result = await addTorrent('key', HASH, { apiBase: BASE, verify: false });
		expect(result.ok === false && result.message).toBe('That magnet is not acceptable.');
	});

	it('does not mistake a 200 with success false for a success', async () => {
		stubTorbox(() => ({
			status: 200,
			body: { success: false, error: 'SOMETHING', detail: 'no' },
		}));
		expect(await addTorrent('key', HASH, { apiBase: BASE, verify: false })).toMatchObject({
			ok: false,
		});
	});

	it('warns rather than failing when the add does not show up in the list', async () => {
		// The create succeeded. Reporting it as a failure would be a lie.
		stubTorbox((url) => (url.includes('createtorrent') ? created(42) : onAccount(false)));
		const result = await addTorrent('key', HASH, { apiBase: BASE });
		expect(result).toMatchObject({ ok: true });
		expect(result.ok === true && result.verificationWarning).toMatch(/may still be settling/);
	});

	it('warns rather than failing when the list read itself fails', async () => {
		stubTorbox((url) =>
			url.includes('createtorrent') ? created(42) : { status: 500, body: { success: false } }
		);
		const result = await addTorrent('key', HASH, { apiBase: BASE });
		expect(result.ok).toBe(true);
		expect(result.ok === true && result.verificationWarning).toBeDefined();
	});

	it('skips the list read entirely when verification is off', async () => {
		const { mock } = stubTorbox(() => created(42));
		await addTorrent('key', HASH, { apiBase: BASE, verify: false });
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it('never puts the key in a URL', async () => {
		const { sent } = stubTorbox((url) =>
			url.includes('createtorrent') ? created(42) : onAccount(true)
		);
		await addTorrent('super-secret', HASH, { apiBase: BASE });
		expect(sent.some((s) => s.url.includes('super-secret'))).toBe(false);
		expect(sent[0].init?.headers).toMatchObject({ Authorization: 'Bearer super-secret' });
	});

	it('matches the account list by hash, case-insensitively', async () => {
		stubTorbox((url) =>
			url.includes('createtorrent')
				? created(42)
				: { status: 200, body: { success: true, data: [{ hash: HASH.toUpperCase() }] } }
		);
		const result = await addTorrent('key', HASH, { apiBase: BASE });
		expect(result.ok === true && result.verificationWarning).toBeUndefined();
	});

	it('tolerates a trailing slash on the API base', async () => {
		const { sent } = stubTorbox((url) =>
			url.includes('createtorrent') ? created(1) : onAccount(true)
		);
		await addTorrent('key', HASH, { apiBase: `${BASE}/` });
		expect(sent[0].url.startsWith(`${BASE}/v1/`)).toBe(true);
	});
});

describe('pacedAdd', () => {
	it('keeps two adds at least a second apart', async () => {
		vi.useFakeTimers();
		const starts: number[] = [];
		const work = () => {
			starts.push(Date.now());
			return Promise.resolve();
		};
		const both = Promise.all([pacedAdd(work), pacedAdd(work)]);
		await vi.advanceTimersByTimeAsync(5000);
		await both;
		expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
		vi.useRealTimers();
	});
});
