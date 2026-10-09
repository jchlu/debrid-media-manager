import {
	episodeLabel,
	expectedEpisodes,
	fetchMovieInfo,
	fetchShowInfo,
	type MediaInfo,
} from '@/tui/dmm/info';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE = 'http://dmm.internal:3000';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function infoStub(body: unknown, status = 200) {
	// The parameter is declared so `mock.calls[0][0]` is typed as the URL rather
	// than as an empty tuple.
	const mock = vi.fn(
		async (_input: RequestInfo | URL) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' },
			})
	);
	vi.stubGlobal('fetch', mock);
	return mock;
}

describe('fetchMovieInfo', () => {
	it('reads the title and year', async () => {
		infoStub({ title: 'Dune: Part Two', year: 2024, description: 'x', poster: 'y' });
		await expect(fetchMovieInfo(BASE, 'tt15239678')).resolves.toEqual({
			imdbid: 'tt15239678',
			title: 'Dune: Part Two',
			year: 2024,
		});
	});

	it('asks for the id it was given', async () => {
		const mock = infoStub({ title: 'x' });
		await fetchMovieInfo(BASE, 'tt0111161');
		const url = new URL(String(mock.mock.calls[0][0]));
		expect(url.pathname).toBe('/api/info/movie');
		expect(url.searchParams.get('imdbid')).toBe('tt0111161');
	});

	it('tolerates a response with no year', async () => {
		infoStub({ title: 'Untitled' });
		await expect(fetchMovieInfo(BASE, 'tt1')).resolves.toEqual({
			imdbid: 'tt1',
			title: 'Untitled',
			year: undefined,
		});
	});
});

describe('fetchShowInfo', () => {
	it('reads the season episode counts, re-keyed to numbers', async () => {
		// cinemeta returns these keyed by string; a label built straight off that
		// would read "8" where it means season 8.
		infoStub({
			title: 'Breaking Bad',
			season_episode_counts: { '1': 7, '2': 13, '5': 16 },
		});
		const info = await fetchShowInfo(BASE, 'tt0903747');
		expect(info.seasonEpisodeCounts).toEqual({ 1: 7, 2: 13, 5: 16 });
	});

	it('leaves the counts undefined rather than empty when none arrive', async () => {
		infoStub({ title: 'Show', season_episode_counts: {} });
		const info = await fetchShowInfo(BASE, 'tt1');
		expect(info.seasonEpisodeCounts).toBeUndefined();
	});

	it('drops a nonsense count instead of storing NaN', async () => {
		infoStub({ title: 'Show', season_episode_counts: { '1': 7, x: 3, '2': 0 } });
		const info = await fetchShowInfo(BASE, 'tt1');
		expect(info.seasonEpisodeCounts).toEqual({ 1: 7 });
	});

	it('reads last_episode_to_air', async () => {
		infoStub({
			title: 'Show',
			last_episode_to_air: { season_number: 2, episode_number: 5 },
		});
		const info = await fetchShowInfo(BASE, 'tt1');
		expect(info.lastEpisodeToAir).toEqual({ season_number: 2, episode_number: 5 });
	});

	it('treats an unreadable last_episode_to_air as absent', async () => {
		infoStub({ title: 'Show', last_episode_to_air: null });
		const info = await fetchShowInfo(BASE, 'tt1');
		expect(info.lastEpisodeToAir).toBeNull();
	});
});

describe('expectedEpisodes', () => {
	const show = (over: Partial<MediaInfo> = {}): MediaInfo => ({
		imdbid: 'tt1',
		title: 'Show',
		...over,
	});

	it('counts a completed season by what the season lists', () => {
		expect(expectedEpisodes(show({ seasonEpisodeCounts: { 1: 7 } }), 1)).toBe(7);
	});

	it('counts a season still airing by what has aired', () => {
		// The case that matters. cinemeta lists the whole ordered season, so a
		// pack can never satisfy a currently-airing season and every add would
		// read as a gap.
		expect(
			expectedEpisodes(
				show({
					seasonEpisodeCounts: { 5: 16 },
					lastEpisodeToAir: { season_number: 5, episode_number: 9 },
				}),
				5
			)
		).toBe(9);
	});

	it('leaves a completed season alone when last_episode_to_air names another', () => {
		expect(
			expectedEpisodes(
				show({
					seasonEpisodeCounts: { 1: 7, 2: 13 },
					lastEpisodeToAir: { season_number: 2, episode_number: 3 },
				}),
				1
			)
		).toBe(7);
	});

	it('falls back to 13 for a season no provider counted', () => {
		expect(expectedEpisodes(show(), 4)).toBe(13);
		expect(expectedEpisodes(show({ seasonEpisodeCounts: { 1: 7 } }), 4)).toBe(13);
	});

	it('caps rather than raises when a provider undercounts', () => {
		// The cap is one-directional on purpose: it stops a listed count running
		// ahead of what has aired, which is the bug. It does not reconcile a stale
		// count upward from last_episode_to_air — a pack of 2 against a listing of
		// 2 reads Complete, which is what the provider's own data supports.
		expect(
			expectedEpisodes(
				show({
					seasonEpisodeCounts: { 3: 2 },
					lastEpisodeToAir: { season_number: 3, episode_number: 5 },
				}),
				3
			)
		).toBe(2);
	});
});

describe('episodeLabel', () => {
	it.each([
		[8, 8, 'Complete (8/8)'],
		[5, 8, 'Incomplete (5/8)'],
		[1, 8, 'Single'],
		[10, 8, 'With extras (10/8)'],
	])('labels %i against %i as %s', (count, expected, label) => {
		expect(episodeLabel(count, expected)).toBe(label);
	});
});
