import type { GridRow, TbState } from '@/tui/logic/types';

/**
 * The `/` filter line, in the grammar the browser's quick search already uses.
 *
 * Same operators, a different row type. The browser filters `SearchResult`, which
 * carries a flag per debrid provider; a grid has one provider and a four-valued
 * state, so `is:` means something different here and the translation is written out
 * below rather than guessed at by a reader who assumes the two are interchangeable.
 *
 * `quickSearch` itself is not reused, and the reason is a dependency rather than a
 * preference: `SearchResult` lives in `services/mediasearch`, which imports
 * `@ctrl/video-filename-parser`. Importing it would pull a web-only parser into the
 * TUI process for one function, which is the same coupling that made the grid
 * awkward to lift out in the first place.
 */

export type Comparator = 'eq' | 'lt' | 'gt';

/**
 * A `videos:` term, or null when the term is not one.
 *
 * The count compared against is Torbox's *measured* listing, not one guessed from
 * the release name. That matters: `videoCount` is zero for every uncached row
 * (`normalise.ts` fills it from the probe, and an uncached hash has no listing), so
 * `videos:>5` matches only cached rows. An uncached season pack with ten episodes
 * in its name still counts as zero, because nobody has listed it to find out
 * otherwise.
 *
 * That is the honest number — a title-parsed episode count would be a guess, and
 * this client does not present guesses as facts — but it does mean `videos:` is a
 * filter over what Torbox holds rather than over what a pack contains.
 */
export function parseVideoCount(term: string): { count: number; cmp: Comparator } | null {
	if (!term.startsWith('videos:')) return null;
	const value = term.slice('videos:'.length);
	if (/^\d+$/.test(value)) return { count: Number(value), cmp: 'eq' };
	// Both spellings are accepted because the browser accepts them, and a filter
	// that silently drops `videos:>5` reads as "this title has no season packs".
	if (value.startsWith('<') && /^\d+$/.test(value.slice(1))) {
		return { count: Number(value.slice(1)), cmp: 'lt' };
	}
	if (value.startsWith('>') && /^\d+$/.test(value.slice(1))) {
		return { count: Number(value.slice(1)), cmp: 'gt' };
	}
	return null;
}

/** The grid's four states, under the names the browser uses for providers. */
const STATE_TERMS: Record<string, TbState> = {
	tb: 'instant',
	cached: 'instant',
	instant: 'instant',
	uncached: 'uncached',
	archive: 'archive',
};

const byComparator = (count: number, cmp: Comparator, against: number) => {
	if (cmp === 'eq') return count === against;
	return cmp === 'lt' ? count < against : count > against;
};

/**
 * One term against one row.
 *
 * Exclusions are the browser's rule: a leading `-` negates whatever the rest
 * matches, so `-is:tb` is "not cached" rather than a literal search for "-is:tb".
 */
export function matchesTerm(row: GridRow, term: string): boolean {
	// A lone hyphen is a separator people type while thinking, not a search.
	if (term === '-') return true;

	const exclusion = term.startsWith('-');
	const body = (exclusion ? term.slice(1) : term).toLowerCase();
	if (!body) return true;

	let matches: boolean;

	const video = parseVideoCount(body);
	if (video) {
		matches = byComparator(row.videoCount, video.cmp, video.count);
	} else if (body.startsWith('is:')) {
		const value = body.slice(3);
		if (value === 'added') {
			// Not a browser operator: the grid knows what this session has added,
			// and that is the one question a release list cannot answer later.
			matches = row.added === true;
		} else {
			const state = STATE_TERMS[value];
			// An unrecognised `is:` matches nothing rather than everything. A typo
			// that silently passes shows the full list and reads as "no effect".
			matches = state !== undefined && row.state === state;
		}
	} else {
		// The grid shows a 12-character hash prefix, so the thing someone reads off
		// the screen has to be something they can paste back in.
		matches = row.hash === body || row.hash.startsWith(body);
		if (!matches) {
			try {
				matches = new RegExp(body, 'i').test(row.title);
			} catch {
				// A half-typed regex like "blade[" throws. The browser falls back to
				// a hash match here; matching nothing would blank the grid mid-word.
				matches = false;
			}
		}
	}

	return exclusion ? !matches : matches;
}

/** Every term must match, as in the browser. An empty query changes nothing. */
export function applyFilter(rows: GridRow[], query: string): GridRow[] {
	const terms = query.trim().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return rows;
	return rows.filter((row) => terms.every((term) => matchesTerm(row, term)));
}

/**
 * What the grid says when a filter hid everything.
 *
 * "0 rows" is not an answer: an unmatched `videos:>12` and an unrecognised `is:`
 * look identical on screen, and only one of them is worth fixing.
 */
export function describeEmptyFilter(query: string): string {
	const terms = query.trim().split(/\s+/).filter(Boolean);
	const unknownOperator = terms.find((term) => {
		const body = term.startsWith('-') ? term.slice(1) : term;
		if (!body.startsWith('is:')) return false;
		const value = body.slice(3);
		return value !== 'added' && STATE_TERMS[value] === undefined;
	});
	if (unknownOperator) {
		return `no row matches "${unknownOperator}" — known operators are is:tb, is:cached, is:uncached, is:archive, is:added, videos:N.`;
	}
	return `no row matches "${query.trim()}".`;
}
