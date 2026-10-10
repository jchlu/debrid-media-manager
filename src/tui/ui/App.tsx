import type { Config } from '@/tui/config';
import { episodeLabel, expectedEpisodes, fetchMovieInfo, fetchShowInfo } from '@/tui/dmm/info';
import { createReleasesClient, type Release } from '@/tui/dmm/releases';
import { asImdbId, searchTitles, type Title } from '@/tui/dmm/titles';
import { visibleRows } from '@/tui/logic/normalise';
import type { GridRow } from '@/tui/logic/types';
import { probeTorBox } from '@/tui/torbox/probe';
import Footer from '@/tui/ui/Footer';
import GridScreen from '@/tui/ui/GridScreen';
import SearchScreen from '@/tui/ui/SearchScreen';
import { colourEnabled, palette } from '@/tui/ui/theme';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Screen = 'search' | 'grid';

type Status = { text: string; kind: 'info' | 'warn' | 'error' } | null;

const NO_STATUS: Status = null;

export type AppProps = {
	config: Config;
	/** Jump straight to the grid, from `--query`. */
	initialQuery?: string;
	onQuit: () => void;
};

export default function App({ config, initialQuery, onQuit }: AppProps) {
	const colour = useMemo(() => palette(colourEnabled()), []);
	const { exit } = useApp();
	const { stdout } = useStdout();

	const [screen, setScreen] = useState<Screen>('search');
	const [query, setQuery] = useState(initialQuery ?? '');
	const [titles, setTitles] = useState<Title[]>([]);
	const [titleIndex, setTitleIndex] = useState(0);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<Status>(NO_STATUS);
	/** Whether a search has actually run for the current query. Without this the
	 *  picker says "nothing found" while the user is still typing. */
	const [searched, setSearched] = useState(false);

	const [gridTitle, setGridTitle] = useState('');
	const [season, setSeason] = useState<number | undefined>(undefined);
	const [seasons, setSeasons] = useState<number[]>([]);
	const [allRows, setAllRows] = useState<GridRow[]>([]);
	const [selected, setSelected] = useState(0);
	const [unknownCount, setUnknownCount] = useState(0);
	const [expected, setExpected] = useState<number | undefined>(undefined);
	const [guards, setGuards] = useState({
		showUncached: config.showUncached,
		showArchiveOnly: config.showArchiveOnly,
	});

	const releases = useMemo(() => createReleasesClient(config.dmmBaseUrl), [config.dmmBaseUrl]);

	// Ink redraws on its own, but the grid is recomputed from the terminal width,
	// so a resize has to force a re-render rather than only re-lay-out.
	// Read from `process.stdout`, not Ink's handle: Ink 8 types its `stdout` as a
	// bare WritableStream, which has no `columns`.
	const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns ?? 80);
	const [terminalHeight, setTerminalHeight] = useState(process.stdout.rows ?? 24);
	useEffect(() => {
		const onResize = () => {
			setTerminalWidth(process.stdout.columns ?? 80);
			setTerminalHeight(process.stdout.rows ?? 24);
		};
		process.stdout.on('resize', onResize);
		return () => {
			process.stdout.off('resize', onResize);
		};
	}, []);

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			onQuit();
			exit();
		}
	});

	/** Challenge → releases → Torbox probe → grid rows. */
	const loadGrid = useCallback(
		async (title: Title, wantedSeason?: number) => {
			setBusy(true);
			setStatus(NO_STATUS);
			try {
				const rows: Release[] =
					title.type === 'show' && wantedSeason !== undefined
						? (await releases.season(title.imdbid, wantedSeason)).releases
						: (await releases.movie(title.imdbid)).releases;

				// A title with no releases cannot be probed, and asking Torbox
				// about nothing is a wasted round trip.
				const probe = rows.length
					? await probeTorBox(
							config.torboxApiKey,
							rows.map((r) => r.hash),
							config.torboxApiBase
						)
					: { cached: new Set<string>(), unknown: new Set<string>(), files: new Map() };
				setUnknownCount(probe.unknown.size);

				const { toGridRows } = await import('@/tui/logic/normalise');
				setAllRows(toGridRows(rows, probe));
				setSelected(0);

				if (title.type === 'show') {
					const info = await fetchShowInfo(config.dmmBaseUrl, title.imdbid).catch(
						() => null
					);
					const counts = info?.seasonEpisodeCounts;
					setSeasons(
						Object.keys(counts ?? {})
							.map(Number)
							.filter((n) => n > 0)
							.sort((a, b) => a - b)
					);
					setExpected(
						wantedSeason === undefined
							? undefined
							: expectedEpisodes(
									info ?? { imdbid: title.imdbid, title: title.title },
									wantedSeason
								)
					);
				} else {
					await fetchMovieInfo(config.dmmBaseUrl, title.imdbid).catch(() => null);
					setSeasons([]);
					setExpected(undefined);
				}
				setScreen('grid');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (/not scraped/.test(message)) {
					// A not-yet-scraped title is a state of the *grid*, not of the
					// picker: the user needs the keys, and staying on the search
					// screen hid all of them.
					setAllRows([]);
					setSelected(0);
					setUnknownCount(0);
					setSeason(wantedSeason);
					setSeasons([]);
					setExpected(undefined);
					setScreen('grid');
					setStatus({
						text: 'DMM has not scraped this title yet — a scrape was queued. Press esc to go back.',
						kind: 'warn',
					});
				} else {
					setStatus({ text: message, kind: 'error' });
				}
			} finally {
				setBusy(false);
			}
		},
		[config.dmmBaseUrl, config.torboxApiBase, config.torboxApiKey, releases]
	);

	const runSearch = useCallback(async () => {
		const trimmed = query.trim();
		if (!trimmed) return;
		const imdbId = asImdbId(trimmed);
		if (imdbId) {
			await loadGrid({ imdbid: imdbId, type: 'movie', title: imdbId });
			return;
		}
		setBusy(true);
		setStatus(NO_STATUS);
		try {
			setTitles(await searchTitles(config.dmmBaseUrl, trimmed));
			setTitleIndex(0);
			setSearched(true);
		} catch (error) {
			setStatus({
				text: error instanceof Error ? error.message : String(error),
				kind: 'error',
			});
		} finally {
			setBusy(false);
		}
	}, [config.dmmBaseUrl, loadGrid, query]);

	useEffect(() => {
		if (initialQuery) void runSearch();
	}, [initialQuery, runSearch]);

	const rows = useMemo(() => visibleRows(allRows, guards), [allRows, guards]);

	const changeSeason = useCallback(
		(delta: number) => {
			if (!seasons.length || season === undefined) return;
			const at = seasons.indexOf(season);
			const next = seasons[Math.min(Math.max(0, at + delta), seasons.length - 1)];
			if (next === undefined || next === season) return;
			const title = titles.find((t) => t.type === 'show');
			if (!title) return;
			setSeason(next);
			void loadGrid(title, next);
		},
		[loadGrid, season, seasons, titles]
	);

	if (screen === 'search') {
		return (
			<Box flexDirection="column">
				<SearchScreen
					colour={colour}
					query={query}
					onQuery={(value) => {
						setQuery(value);
						setSearched(false);
					}}
					titles={titles}
					selected={titleIndex}
					onSelect={setTitleIndex}
					onSubmit={() => {
						const title = titles[titleIndex];
						// Enter either searches, or opens what is already listed.
						// Doing nothing when the list is empty made the key look dead.
						if (title) void loadGrid(title);
						else void runSearch();
					}}
					busy={busy}
					searched={searched}
					status={status?.text ?? ''}
					directId={asImdbId(query)}
				/>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<GridScreen
				colour={colour}
				title={gridTitle || titles.find((t) => t.imdbid)?.title || ''}
				season={season}
				seasons={seasons}
				rows={rows}
				selected={Math.min(selected, Math.max(0, rows.length - 1))}
				onSelect={setSelected}
				width={terminalWidth}
				height={terminalHeight}
				expectedEpisodes={expected}
				busy={busy}
				onBack={() => {
					setScreen('search');
					setStatus(NO_STATUS);
				}}
				onToggleUncached={() => setGuards((g) => ({ ...g, showUncached: !g.showUncached }))}
				onToggleArchives={() =>
					setGuards((g) => ({ ...g, showArchiveOnly: !g.showArchiveOnly }))
				}
				onSeason={changeSeason}
				onAdd={() =>
					setStatus({
						text: 'Adding is not wired up yet — it arrives in the next slice.',
						kind: 'info',
					})
				}
				onQuit={() => {
					onQuit();
					exit();
				}}
			/>
			<Footer
				colour={colour}
				filter={config.defaultFilter}
				filterFocused={false}
				unknownCount={unknownCount}
				shown={rows.length}
				total={allRows.length}
				status={status?.text ?? ''}
				statusKind={status?.kind ?? 'info'}
				keys={
					`a add · u ${guards.showUncached ? 'hide' : 'show'} uncached · ` +
					`z ${guards.showArchiveOnly ? 'hide' : 'show'} archives · esc back · ctrl-c quit`
				}
			/>
			{expected !== undefined && rows.length ? (
				<Box>
					<Text color={colour.dim}>
						{`a season of ${expected} episodes — ${episodeLabel(rows[0]?.videoCount ?? 0, expected)}`}
					</Text>
				</Box>
			) : null}
		</Box>
	);
}
