import { dmmGet, readJson } from '@/tui/dmm/client';

/**
 * Finding the IMDb id to search under.
 *
 * Trakt, not `/api/search/title`. That handler looks like the obvious choice —
 * it is the "quick search" endpoint and returns a clean typed row — but it reads
 * DMM's local `ImdbTitles` table, and returns `{ "results": [] }` for every query
 * on a deployment where that table has not been populated (verified: `dune`,
 * `the matrix`, `breaking bad` and `alien` all came back empty). Trakt answers
 * immediately and carries the IMDb id the rest of the pipeline needs, and it is
 * the same source the web `SearchBar` uses for its dropdown
 * (`src/components/SearchBar.tsx:114-150`), so this is not a substitute for the
 * browser's behaviour — it is the browser's behaviour.
 */

export type TitleKind = 'movie' | 'show';

export type Title = {
	imdbid: string;
	type: TitleKind;
	title: string;
	year?: number;
};

type TraktEntry = {
	type?: unknown;
	score?: unknown;
	movie?: { ids?: { imdb?: unknown }; title?: unknown; year?: unknown };
	show?: { ids?: { imdb?: unknown }; title?: unknown; year?: unknown };
};

const asString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const asYear = (value: unknown): number | undefined => {
	const year = typeof value === 'number' ? value : Number(value);
	return Number.isInteger(year) && year > 1800 && year < 2200 ? year : undefined;
};

/**
 * Trakt returns an array whose entries are `{type, movie}` or `{type, show}`.
 *
 * No curation is attempted beyond dropping what cannot be searched: a query for
 * `breaking bad` also returns `El Camino: A Breaking Bad Movie` and a
 * behind-the-scenes feature, and the browser shows those too. The picker shows
 * type, year and title per row and lets the user choose.
 */
export function normaliseTitles(body: unknown): Title[] {
	if (!Array.isArray(body)) return [];
	const titles: Title[] = [];
	for (const entry of body as TraktEntry[]) {
		const kind: TitleKind | undefined =
			entry?.type === 'movie' ? 'movie' : entry?.type === 'show' ? 'show' : undefined;
		if (!kind) continue;
		const payload = kind === 'movie' ? entry.movie : entry.show;
		const imdbid = asString(payload?.ids?.imdb);
		const title = asString(payload?.title);
		// Without an IMDb id there is nothing to search under, and without a
		// title there is nothing to show in the picker.
		if (!imdbid || !title) continue;
		titles.push({ imdbid, type: kind, title, year: asYear(payload?.year) });
	}
	return titles;
}

/**
 * `/api/trakt/search` is exported bare and not wrapped in `withIpRateLimit`, so
 * there is no budget to respect. The `types` filter is sent so one request covers
 * both kinds rather than two racing ones.
 */
export async function searchTitles(baseUrl: string, query: string): Promise<Title[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const path = `/api/trakt/search?query=${encodeURIComponent(trimmed)}&types=movie,show`;
	const res = await dmmGet(baseUrl, path);
	if (!res.ok) {
		throw new Error(`DMM answered ${res.status} when searching Trakt for "${trimmed}".`);
	}
	return normaliseTitles(await readJson<unknown>(res, baseUrl));
}

/** The browser routes an IMDb id straight to the page (`SearchBar.tsx:168-178`). */
export const asImdbId = (query: string): string | undefined => {
	const trimmed = query.trim();
	return /^tt\d{7,}$/.test(trimmed) ? trimmed : undefined;
};
