import type { Config } from '@/tui/config';
import { fetchMovieInfo, fetchShowInfo } from '@/tui/dmm/info';
import type { Release } from '@/tui/dmm/releases';
import { createReleasesClient } from '@/tui/dmm/releases';
import { asImdbId, searchTitles, type Title } from '@/tui/dmm/titles';
import { toGridRows, visibleRows } from '@/tui/logic/normalise';
import type { TbState } from '@/tui/logic/types';
import { probeTorBox } from '@/tui/torbox/probe';

/**
 * `--dump`: run the read path and print what came back, with no UI.
 *
 * Exists because every stage of the pipeline is separately verifiable against a
 * real DMM instance, and a terminal client that only reports failure as "no
 * results" throws that away. Each stage prints its verdict before the next runs,
 * so a break is visible at the stage that broke rather than as an empty grid.
 */

const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);

const headings = {
	challenge: '1. Challenge token',
	titles: '2. Title search',
	info: '3. Media info',
	releases: '4. Releases',
	torbox: '5. Torbox cache probe',
} as const;

/** A bare hash, so a row can be pasted straight into a magnet or a lookup. */
const shortHash = (hash: string) => `${hash.slice(0, 12)}…`;

export async function dump(config: Config, query: string, seasonNum?: number): Promise<number> {
	const releases = createReleasesClient(config.dmmBaseUrl);

	out(`dmm-tui read dump — "${query}"`);
	out(`DMM base URL: ${config.dmmBaseUrl}`);
	out();

	// The challenge is fetched implicitly by the release call, so it is asked for
	// here first to make its own failure readable rather than surfacing later as
	// a 403 on a call the user never made.
	out(headings.challenge);
	try {
		const { createChallengeClient } = await import('@/tui/dmm/challenge');
		const challenge = await createChallengeClient(config.dmmBaseUrl).get();
		out(`  ok — token ${challenge.token.slice(0, 12)}…`);
	} catch (error) {
		err(`  FAILED — ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
	out();

	// An id is searched directly, the way the browser routes `tt…` to a page.
	const directId = asImdbId(query);
	let title: Title | undefined;
	if (directId) {
		title = { imdbid: directId, type: 'movie', title: query };
		out(headings.titles);
		out(`  "${directId}" is an IMDb id, skipping the title search.`);
		out();
	} else {
		out(headings.titles);
		let titles: Title[];
		try {
			titles = await searchTitles(config.dmmBaseUrl, query);
		} catch (error) {
			err(`  FAILED — ${error instanceof Error ? error.message : String(error)}`);
			return 1;
		}
		if (!titles.length) {
			out('  nothing found.');
			out();
			return 0;
		}
		for (const t of titles) {
			out(`  [${t.type.padEnd(5)}] ${t.title}${t.year ? ` (${t.year})` : ''}  ${t.imdbid}`);
		}
		out();
		// The first hit stands in for the user's selection, which is what the
		// picker would provide. Its irrelevance to the query is not this
		// command's problem to judge — the point is to show the shape.
		title = titles[0];
	}

	if (!title) return 0;

	out(headings.info);
	try {
		const info =
			title.type === 'show'
				? await fetchShowInfo(config.dmmBaseUrl, title.imdbid)
				: await fetchMovieInfo(config.dmmBaseUrl, title.imdbid);
		out(`  ${info.title}${info.year ? ` (${info.year})` : ''}`);
		if (info.seasonEpisodeCounts) {
			const entries = Object.entries(info.seasonEpisodeCounts)
				.sort((a, b) => Number(a[0]) - Number(b[0]))
				.map(([season, count]) => `S${season}=${count}`)
				.join(' ');
			out(`  season episode counts: ${entries}`);
		}
		if (info.lastEpisodeToAir) {
			out(
				`  last aired: S${String(info.lastEpisodeToAir.season_number)}E${String(
					info.lastEpisodeToAir.episode_number
				)}`
			);
		}
	} catch (error) {
		// Metadata is decoration here. Losing it should not stop the releases,
		// which are the part worth seeing.
		err(`  FAILED — ${error instanceof Error ? error.message : String(error)}`);
	}
	out();

	out(headings.releases);
	let rows: Release[] = [];
	try {
		const result =
			seasonNum !== undefined && title.type === 'show'
				? await releases.season(title.imdbid, seasonNum)
				: await releases.movie(title.imdbid);
		rows = result.releases;
		out(`  ${rows.length} release(s).`);
		for (const release of rows.slice(0, 20)) {
			const size =
				release.fileSize > 0 ? `${release.fileSize.toFixed(2)} MB` : 'size unknown';
			out(`  ${shortHash(release.hash)}  ${size.padStart(16)}  ${release.title}`);
		}
		if (rows.length > 20) {
			out(`  … and ${rows.length - 20} more.`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not scraped/.test(message)) {
			// Says the same thing the grid says, and for the same reason: a
			// `requested:` key was written, but only an instance that drains it will
			// ever answer. Telling someone to wait is telling them to wait for
			// nothing.
			out(
				'  no releases stored for this title. DMM recorded a scrape request, but nothing ' +
					'will read it unless this instance runs a scraper or an indexer addon.'
			);
			return 0;
		}
		err(`  FAILED — ${message}`);
		return 1;
	}
	out();

	// The Torbox half only runs when there is something to probe, so a --dump
	// against an unscraped title needs no Torbox key at all.
	if (!rows.length) return 0;

	out(headings.torbox);
	// Probing with an empty key reports every row as `unknown`, which reads as
	// "Torbox was asked and declined to answer" when in truth nothing was asked.
	// That is the difference between a broken key and a missing one.
	if (!config.torboxApiKey) {
		out('  no Torbox key configured, so cache states were not probed.');
		return 0;
	}
	out('  probing the Torbox cache…');
	const probe = await probeTorBox(
		config.torboxApiKey,
		rows.map((r) => r.hash),
		config.torboxApiBase
	);
	const grid = toGridRows(rows, probe);
	const shown = visibleRows(grid, {
		showUncached: config.showUncached,
		showArchiveOnly: config.showArchiveOnly,
	});

	const tally = (state: TbState) => grid.filter((r) => r.state === state).length;
	out(
		`  instant ${tally('instant')} · archive ${tally('archive')} · ` +
			`uncached ${tally('uncached')} · unknown ${tally('unknown')}`
	);
	out(`  showing ${shown.length} row(s) under the current guards.`);
	out();
	for (const row of shown.slice(0, 20)) {
		out(
			`  ${row.reachable ? 'ADD' : '   '} ${row.state.padEnd(8)} ` +
				`${String(row.videoCount).padStart(3)} vid  ` +
				`${row.biggestVideoMb.toFixed(0).padStart(7)} MB  ${shortHash(row.hash)}`
		);
	}
	if (probe.unknown.size) {
		out();
		out(`  ${probe.unknown.size} row(s) got no verdict from Torbox, and are not shown.`);
	}

	return 0;
}
