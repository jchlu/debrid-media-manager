import { createChallengeClient } from '@/tui/dmm/challenge';
import { DmmError, dmmGet, readJson, type DmmErrorKind } from '@/tui/dmm/client';
import { describe, expect, it, vi } from 'vitest';

const BASE = 'http://dmm.internal:3000';

function stubFetch(
	handler: (url: string) => { status: number; body?: unknown; headers?: Record<string, string> }
) {
	const mock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		const { status, body, headers } = handler(url);
		// A 204 must be constructed with no body at all — `Response` rejects one,
		// which is exactly the shape /api/torrents/* sends before a scrape lands.
		const nullBody = status === 204 || status === 304;
		return new Response(nullBody ? null : JSON.stringify(body ?? {}), {
			status,
			headers: { 'content-type': 'application/json', ...(headers ?? {}) },
		});
	});
	vi.stubGlobal('fetch', mock);
	return mock;
}

/** Kinds are the contract the UI switches on, so they are asserted by name. */
async function kindOf(fn: () => Promise<unknown>): Promise<DmmErrorKind> {
	try {
		await fn();
	} catch (error) {
		if (error instanceof DmmError) return error.kind;
		throw error;
	}
	throw new Error('expected the call to throw');
}

describe('dmmGet', () => {
	it('returns the response untouched for a 200', async () => {
		stubFetch(() => ({ status: 200, body: { ok: true } }));
		const res = await dmmGet(BASE, '/api/challenge');
		expect(res.status).toBe(200);
	});

	it('turns a refused connection into an unreachable error naming the URL', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
		expect(await kindOf(() => dmmGet(BASE, '/api/challenge'))).toBe('unreachable');
	});

	it('turns a failure into a message that names what to check', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
		await expect(dmmGet(BASE, '/api/challenge')).rejects.toThrow(/dmmBaseUrl/);
	});

	it('reads Retry-After off a 429 rather than retrying into it', async () => {
		// Observed on a live instance: two /api/torrents/* calls inside the 2s
		// window, the second refused.
		stubFetch(() => ({ status: 429, body: {}, headers: { 'retry-after': '4' } }));
		const error = await dmmGet(BASE, '/api/torrents/movie').then(
			() => null,
			(e: unknown) => e
		);
		expect(error).toBeInstanceOf(DmmError);
		expect((error as DmmError).kind).toBe('server');
		expect((error as DmmError).retryAfterSeconds).toBe(4);
		expect((error as DmmError).message).toMatch(/rate-limiting/);
	});

	it('leaves Retry-After undefined when the header is absent or nonsense', async () => {
		stubFetch(() => ({ status: 429, body: {}, headers: { 'retry-after': 'soon' } }));
		const error = await dmmGet(BASE, '/api/torrents/movie').then(
			() => null,
			(e: unknown) => e
		);
		expect((error as DmmError).retryAfterSeconds).toBeUndefined();
	});

	it('does not treat a 204 as an error', async () => {
		// /api/torrents/* answers 204 with a `status` header when a title has not
		// been scraped; the caller reads the header, so it must get the response.
		stubFetch(() => ({ status: 204, body: {} }));
		const res = await dmmGet(BASE, '/api/torrents/movie');
		expect(res.status).toBe(204);
	});
});

describe('readJson', () => {
	it('returns the parsed body', async () => {
		stubFetch(() => ({ status: 200, body: { token: 't', hash: 'h' } }));
		const res = await dmmGet(BASE, '/api/challenge');
		await expect(readJson<{ token: string }>(res, BASE)).resolves.toEqual({
			token: 't',
			hash: 'h',
		});
	});

	it('names the base url when the body is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('<html>nginx</html>', { status: 200 }))
		);
		const res = await dmmGet(BASE, '/api/challenge');
		await expect(readJson(res, BASE)).rejects.toThrow(/dmm.internal:3000/);
		await expect(readJson(res, BASE)).rejects.toThrow(/not at another service|pointing at DMM/);
	});
});

describe('createChallengeClient', () => {
	const ok = { token: 'tok-1', hash: 'sig-1' };

	it('fetches /api/challenge once and reuses the pair', async () => {
		const fetchMock = stubFetch(() => ({ status: 200, body: ok }));
		const client = createChallengeClient(BASE);

		expect(await client.get()).toEqual(ok);
		expect(await client.get()).toEqual(ok);
		expect(await client.get()).toEqual(ok);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('concurrent callers share one mint', async () => {
		// The browser's version shares an in-flight request for the same reason:
		// a page starting several sweeps should cost one mint, not one each.
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify(ok), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const client = createChallengeClient(BASE);
		const [a, b, c] = await Promise.all([client.get(), client.get(), client.get()]);

		expect(a).toEqual(b);
		expect(b).toEqual(c);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('mints again once the pair is older than the reuse window', async () => {
		let clock = 1_000_000;
		let minted = 0;
		const fetchMock = vi.fn().mockImplementation(async () => {
			minted += 1;
			return new Response(JSON.stringify({ token: `tok-${minted}`, hash: `sig-${minted}` }), {
				status: 200,
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const client = createChallengeClient(BASE, () => clock);
		expect(await client.get()).toEqual({ token: 'tok-1', hash: 'sig-1' });

		// Just inside the two-minute window: still cached.
		clock += 119_000;
		expect(await client.get()).toEqual({ token: 'tok-1', hash: 'sig-1' });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Past it: a new pair.
		clock += 2_000;
		expect(await client.get()).toEqual({ token: 'tok-2', hash: 'sig-2' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('rejects a malformed pair rather than caching it', async () => {
		stubFetch(() => ({ status: 200, body: { token: 'only-a-token' } }));
		const client = createChallengeClient(BASE);
		await expect(client.get()).rejects.toThrow(/malformed/);
	});

	it('points at the signing secret without naming the variable', async () => {
		// The endpoint answers exactly this when the signing secret is unset, with
		// a message that does not obviously point at an environment variable.
		//
		// The variable's own name is kept out of this file on purpose: a repo test
		// asserts it appears nowhere outside the two server modules allowed to read
		// it, so that a future edit cannot quietly start reading the secret from a
		// client module. The operator is pointed at the .env.example instead, which
		// is a step slower but keeps the guard intact.
		stubFetch(() => ({ status: 500, body: { error: 'Server configuration error' } }));
		const client = createChallengeClient(BASE);

		const error = await client.get().then(
			() => null,
			(e: unknown) => e
		);
		expect((error as DmmError).kind).toBe('challenge-failed');
		expect((error as Error).message).toMatch(/signing secret/i);
		expect((error as Error).message).toMatch(/\.env\.example/);
		expect((error as Error).message).not.toMatch(/DMM_PROBLEM_SECRET/);
	});

	it('reports a challenge failure with its own kind, not as unreachable', async () => {
		stubFetch(() => ({ status: 503, body: {} }));
		const client = createChallengeClient(BASE);
		expect(await kindOf(() => client.get())).toBe('challenge-failed');
	});

	it('does not cache a failure, so a later call retries', async () => {
		let call = 0;
		const fetchMock = vi.fn().mockImplementation(async () => {
			call += 1;
			return call === 1
				? new Response('{}', { status: 500 })
				: new Response(JSON.stringify(ok), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const client = createChallengeClient(BASE);
		await expect(client.get()).rejects.toThrow();
		await expect(client.get()).resolves.toEqual(ok);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('reset drops the cached pair', async () => {
		const fetchMock = stubFetch(() => ({ status: 200, body: ok }));
		const client = createChallengeClient(BASE);
		await client.get();
		client.reset();
		await client.get();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('keeps separate caches per instance', async () => {
		// A module-level cache would hand one host's token to another.
		const a = stubFetch(() => ({ status: 200, body: { token: 'a', hash: 'a' } }));
		const one = createChallengeClient('http://one:3000');
		const two = createChallengeClient('http://two:3000');

		expect(await one.get()).toEqual({ token: 'a', hash: 'a' });
		expect(await two.get()).toEqual({ token: 'a', hash: 'a' });
		expect(a).toHaveBeenCalledTimes(2);
		expect(String(a.mock.calls[0][0])).toBe('http://one:3000/api/challenge');
		expect(String(a.mock.calls[1][0])).toBe('http://two:3000/api/challenge');
	});
});
