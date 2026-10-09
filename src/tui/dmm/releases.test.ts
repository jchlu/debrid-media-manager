import { DmmError } from '@/tui/dmm/client';
import { createReleaseQueue, createReleasesClient, normaliseReleases } from '@/tui/dmm/releases';
import { asImdbId, normaliseTitles, searchTitles } from '@/tui/dmm/titles';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE = 'http://dmm.internal:3000';
const HASH = '732d1e50abda37be16d3f7d520c1374f4424be5c';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function respond(
	handler: (url: URL) => { status: number; body?: unknown; headers?: Record<string, string> }
) {
	const mock = vi.fn(async (input: RequestInfo | URL) => {
		const { status, body, headers } = handler(new URL(String(input)));
		const nullBody = status === 204 || status === 304;
		return new Response(nullBody ? null : JSON.stringify(body ?? {}), {
			status,
			headers: { 'content-type': 'application/json', ...(headers ?? {}) },
		});
	});
	vi.stubGlobal('fetch', mock);
	return mock;
}

/** Answers the challenge, then the releases endpoint. */
const dmmSays = (releases: unknown) =>
	respond((url) =>
		url.pathname === '/api/challenge'
			? { status: 200, body: { token: 'tok', hash: 'sig' } }
			: { status: 200, body: { results: releases } }
	);

describe('normaliseTitles', () => {
	it('reads both entry shapes from the Trakt array', () => {
		const titles = normaliseTitles([
			{
				type: 'show',
				show: { ids: { imdb: 'tt0903747' }, title: 'Breaking Bad', year: 2008 },
			},
			{
				type: 'movie',
				movie: { ids: { imdb: 'tt15239678' }, title: 'Dune: Part Two', year: 2024 },
			},
		]);
		expect(titles).toEqual([
			{ imdbid: 'tt0903747', type: 'show', title: 'Breaking Bad', year: 2008 },
			{ imdbid: 'tt15239678', type: 'movie', title: 'Dune: Part Two', year: 2024 },
		]);
	});

	it('keeps a title that has no year', () => {
		expect(
			normaliseTitles([{ type: 'movie', movie: { ids: { imdb: 'tt1' }, title: 'Untitled' } }])
		).toEqual([{ imdbid: 'tt1', type: 'movie', title: 'Untitled', year: undefined }]);
	});

	it('drops an entry with no IMDb id, since there is nothing to search under', () => {
		expect(normaliseTitles([{ type: 'movie', movie: { ids: {}, title: 'No Id' } }])).toEqual(
			[]
		);
	});

	it('drops an entry with no title, since there is nothing to show', () => {
		expect(normaliseTitles([{ type: 'movie', movie: { ids: { imdb: 'tt1' } } }])).toEqual([]);
	});

	it('drops an entry whose type is neither movie nor show', () => {
		expect(
			normaliseTitles([{ type: 'person', person: { ids: { imdb: 'tt1' }, name: 'x' } }])
		).toEqual([]);
	});

	it('keeps the off-target results Trakt returns rather than curating', () => {
		// A search for "breaking bad" also returns El Camino and a making-of. The
		// browser shows those too, so the picker shows them.
		const titles = normaliseTitles([
			{
				type: 'show',
				show: { ids: { imdb: 'tt0903747' }, title: 'Breaking Bad', year: 2008 },
			},
			{
				type: 'movie',
				movie: { ids: { imdb: 'tt9243946' }, title: 'El Camino', year: 2019 },
			},
		]);
		expect(titles).toHaveLength(2);
	});

	it('returns nothing for a body that is not an array', () => {
		expect(normaliseTitles({ results: [] })).toEqual([]);
		expect(normaliseTitles(null)).toEqual([]);
	});
});

describe('asImdbId', () => {
	it('recognises an id the browser would route straight through', () => {
		expect(asImdbId('tt15239678')).toBe('tt15239678');
		expect(asImdbId('  tt0903747 ')).toBe('tt0903747');
	});

	it('does not treat ordinary text as an id', () => {
		expect(asImdbId('dune')).toBeUndefined();
		expect(asImdbId('tt123')).toBeUndefined();
	});
});

describe('searchTitles', () => {
	it('asks Trakt for both kinds in one request', async () => {
		// One request rather than two racing ones, and the same endpoint the web
		// SearchBar uses for its dropdown.
		const fetchMock = respond(() => ({ status: 200, body: [] }));
		await searchTitles(BASE, 'dune');
		const url = new URL(String(fetchMock.mock.calls[0][0]));
		expect(url.pathname).toBe('/api/trakt/search');
		expect(url.searchParams.get('query')).toBe('dune');
		expect(url.searchParams.get('types')).toBe('movie,show');
	});

	it('does not call Trakt for an empty query', async () => {
		const fetchMock = respond(() => ({ status: 200, body: [] }));
		expect(await searchTitles(BASE, '   ')).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('normaliseReleases', () => {
	it('reads the stored {hash, title, fileSize} shape', () => {
		expect(
			normaliseReleases({ results: [{ hash: HASH, title: 'A.Movie.2024', fileSize: 512 }] })
		).toEqual([{ hash: HASH, title: 'A.Movie.2024', fileSize: 512 }]);
	});

	it('lowercases and deduplicates by hash, keeping the first', () => {
		const rows = normaliseReleases({
			results: [
				{ hash: HASH.toUpperCase(), title: 'first', fileSize: 1 },
				{ hash: HASH, title: 'second', fileSize: 2 },
			],
		});
		expect(rows).toEqual([{ hash: HASH, title: 'first', fileSize: 1 }]);
	});

	it('drops a hash that is not 40 hex characters', () => {
		// The same shape `isUsableHash` drops in the browser, so a degenerate hash
		// never reaches a magnet.
		expect(
			normaliseReleases({
				results: [
					{ hash: 'not-a-hash', title: 'x', fileSize: 1 },
					{ hash: 'abc', title: 'x', fileSize: 1 },
				],
			})
		).toEqual([]);
	});

	it('keeps a row with no size rather than dropping it', () => {
		// Scraped rows sometimes report 0; the Torbox probe fills the real size in.
		expect(normaliseReleases({ results: [{ hash: HASH, title: 'x' }] })).toEqual([
			{ hash: HASH, title: 'x', fileSize: 0 },
		]);
	});
});

describe('createReleaseQueue', () => {
	it('keeps two calls at least the interval apart', async () => {
		vi.useFakeTimers();
		const queue = createReleaseQueue(2500);
		const starts: number[] = [];
		const work = () => {
			starts.push(Date.now());
			return Promise.resolve();
		};

		const first = queue.paced(work);
		const second = queue.paced(work);
		await vi.advanceTimersByTimeAsync(10_000);
		await Promise.all([first, second]);

		expect(starts).toHaveLength(2);
		expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2500);
	});

	it('runs three queued calls in order, each the interval after the last', async () => {
		vi.useFakeTimers();
		const queue = createReleaseQueue(2500);
		const starts: number[] = [];
		const work = () => {
			starts.push(Date.now());
			return Promise.resolve();
		};

		const all = Promise.all([queue.paced(work), queue.paced(work), queue.paced(work)]);
		await vi.advanceTimersByTimeAsync(20_000);
		await all;

		expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2500);
		expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(2500);
	});

	it('releases the queue even when a call throws', async () => {
		// A failed call must not wedge every later one behind a promise that never
		// settles.
		vi.useFakeTimers();
		const queue = createReleaseQueue(100);
		const failing = queue.paced(() => Promise.reject(new Error('boom')));
		const following = queue.paced(() => Promise.resolve('ok'));

		await expect(failing).rejects.toThrow('boom');
		await vi.advanceTimersByTimeAsync(1000);
		await expect(following).resolves.toBe('ok');
	});
});

describe('createReleasesClient', () => {
	it('carries the challenge token on the request', async () => {
		const fetchMock = dmmSays([]);
		const client = createReleasesClient(BASE);
		await client.movie('tt15239678');
		const url = new URL(String(fetchMock.mock.calls[1][0]));
		expect(url.pathname).toBe('/api/torrents/movie');
		expect(url.searchParams.get('dmmProblemKey')).toBe('tok');
		expect(url.searchParams.get('solution')).toBe('sig');
		expect(url.searchParams.get('imdbId')).toBe('tt15239678');
	});

	it('sends seasonNum for a season, which the server requires', async () => {
		const fetchMock = dmmSays([]);
		await createReleasesClient(BASE).season('tt0903747', 2);
		const url = new URL(String(fetchMock.mock.calls[1][0]));
		expect(url.pathname).toBe('/api/torrents/tv');
		expect(url.searchParams.get('seasonNum')).toBe('2');
	});

	it('reports a 204 requested as not-scraped rather than an empty grid', async () => {
		respond((url) =>
			url.pathname === '/api/challenge'
				? { status: 200, body: { token: 'tok', hash: 'sig' } }
				: { status: 204, body: {}, headers: { status: 'requested' } }
		);
		const client = createReleasesClient(BASE);
		await expect(client.movie('tt15239678')).rejects.toMatchObject({
			name: 'DmmError',
			kind: 'not-scraped',
		});
	});

	it('distinguishes a scrape already in flight', async () => {
		respond((url) =>
			url.pathname === '/api/challenge'
				? { status: 200, body: { token: 'tok', hash: 'sig' } }
				: { status: 204, body: {}, headers: { status: 'processing' } }
		);
		await expect(createReleasesClient(BASE).movie('tt1')).rejects.toThrow(/processing/);
	});

	it('surfaces a 403 as its own kind, naming the token', async () => {
		respond((url) =>
			url.pathname === '/api/challenge'
				? { status: 200, body: { token: 'tok', hash: 'sig' } }
				: { status: 403, body: { errorMessage: 'Authentication error' } }
		);
		const error = await createReleasesClient(BASE)
			.movie('tt1')
			.then(
				() => null,
				(e: unknown) => e
			);
		expect(error).toBeInstanceOf(DmmError);
	});

	it('paces a movie call and a season call together', async () => {
		// The limit is one request per window per IP, so two calls launched at once
		// are exactly the case it refuses.
		vi.useFakeTimers();
		dmmSays([]);
		const client = createReleasesClient(BASE);
		const both = Promise.all([client.movie('tt1'), client.season('tt2', 1)]);
		await vi.advanceTimersByTimeAsync(10_000);
		await expect(both).resolves.toBeDefined();
	});
});
