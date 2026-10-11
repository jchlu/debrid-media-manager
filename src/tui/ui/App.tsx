import type { Config } from '@/tui/config';
import { episodeLabel, expectedEpisodes, fetchShowInfo } from '@/tui/dmm/info';
import { createReleasesClient, type Release } from '@/tui/dmm/releases';
import { asImdbId, searchTitles, type Title } from '@/tui/dmm/titles';
import { decideAdd } from '@/tui/logic/addRequest';
import { applyFilter, describeEmptyFilter } from '@/tui/logic/filter';
import { toGridRows, visibleRows } from '@/tui/logic/normalise';
import {
	applyPageLoaded,
	describePaging,
	FIRST_PAGE,
	planPageMove,
	type PagingState,
} from '@/tui/logic/paging';
import type { GridRow } from '@/tui/logic/types';
import { addTorrent, pacedAdd } from '@/tui/torbox/add';
import { probeTorBox, type ProbeFile } from '@/tui/torbox/probe';
import { describeCopy, sendToClipboard } from '@/tui/ui/clipboard';
import ConfirmScreen from '@/tui/ui/ConfirmScreen';
import FileListModal from '@/tui/ui/FileListModal';
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
	/** The title the grid is currently showing, so `r` can reload it. */
	const [currentTitle, setCurrentTitle] = useState<Title | null>(null);
	const [season, setSeason] = useState<number | undefined>(undefined);
	const [seasons, setSeasons] = useState<number[]>([]);
	/**
	 * Grid rows by DMM page.
	 *
	 * Kept per page so `[` never re-asks for a page already on the client, which
	 * is the difference between scrolling and spending the one rate-limited
	 * request per 2.5s each time you move back up the list.
	 */
	const [pageRows, setPageRows] = useState<Map<number, GridRow[]>>(new Map());
	const [paging, setPaging] = useState<PagingState>(FIRST_PAGE);
	const [selected, setSelected] = useState(0);
	const [expected, setExpected] = useState<number | undefined>(undefined);
	/**
	 * The applied `/` filter. Starts empty on purpose: `config.defaultFilter` is
	 * `is:tb`, and applying it would silently defeat the `u` toggle that reveals
	 * uncached rows — the filter would hide exactly what the guard allowed.
	 */
	const [filter, setFilter] = useState('');
	const [filtering, setFiltering] = useState(false);
	/** The filter as it was when `/` was pressed, so esc can put it back. */
	const [filterBeforeOpen, setFilterBeforeOpen] = useState('');
	const [guards, setGuards] = useState({
		showUncached: config.showUncached,
		showArchiveOnly: config.showArchiveOnly,
	});

	/** File listings from the last probe, for the file-list modal. */
	const [probeFiles, setProbeFiles] = useState<Map<string, ProbeFile[]>>(new Map());
	/** Rows being added right now, so a second `a` cannot double-add. */
	const [adding, setAdding] = useState<Set<string>>(new Set());
	/** The row a confirmation is pending for. */
	const [confirming, setConfirming] = useState<GridRow | null>(null);
	/** The row whose file list is open. */
	const [viewingFiles, setViewingFiles] = useState<GridRow | null>(null);

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
		async (title: Title, wantedSeason?: number, page = 0) => {
			setBusy(true);
			setStatus(NO_STATUS);
			setCurrentTitle(title);
			try {
				const rows: Release[] =
					title.type === 'show' && wantedSeason !== undefined
						? (await releases.season(title.imdbid, wantedSeason, page)).releases
						: (await releases.movie(title.imdbid, page)).releases;

				// A title with no releases cannot be probed, and asking Torbox
				// about nothing is a wasted round trip.
				const probe = rows.length
					? await probeTorBox(
							config.torboxApiKey,
							rows.map((r) => r.hash),
							config.torboxApiBase
						)
					: { cached: new Set<string>(), unknown: new Set<string>(), files: new Map() };

				const grid = toGridRows(rows, probe);
				setPageRows((prev) => new Map(prev).set(page, grid));
				setPaging((prev) => applyPageLoaded(prev, page, grid));
				// Merged rather than replaced: file listings for a page already on
				// screen are still accurate, and re-probing them costs a request.
				setProbeFiles((prev) => new Map([...prev, ...probe.files]));
				setSelected(0);

				// Season and episode counts belong to the title, not the page, so
				// they are fetched once. Re-asking on every `]` would spend the
				// rate limit to recompute an answer already held.
				if (page === 0 && title.type === 'show') {
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
				} else if (page === 0) {
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
					setPaging(FIRST_PAGE);
					setSelected(0);
					setSeason(wantedSeason);
					setSeasons([]);
					setExpected(undefined);
					setScreen('grid');
					// Deliberately does not promise a result. A scrape request was
					// recorded, but nothing drains that queue unless this DMM runs a
					// scraper — a local instance with no scraper worker will answer
					// exactly like this forever. Saying "queued" alone would send the
					// user off waiting for something that is never coming.
					setStatus({
						text:
							'This DMM has no releases for that title yet. A scrape request was recorded, ' +
							'but only an instance running a scraper will answer it. Press r to retry, esc to go back.',
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

	/** Forgets every fetched page, for when the title or season changes. */
	const resetPages = useCallback(() => {
		setPageRows(new Map());
		setPaging(FIRST_PAGE);
		setSelected(0);
	}, []);

	const runSearch = useCallback(async () => {
		const trimmed = query.trim();
		if (!trimmed) return;
		const imdbId = asImdbId(trimmed);
		if (imdbId) {
			resetPages();
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
	}, [config.dmmBaseUrl, loadGrid, query, resetPages]);

	useEffect(() => {
		if (initialQuery) void runSearch();
	}, [initialQuery, runSearch]);

	/** The page on screen, before guards and before the `/` filter. */
	const currentPageRows = useMemo(() => pageRows.get(paging.page) ?? [], [pageRows, paging.page]);

	const rows = useMemo(
		() => applyFilter(visibleRows(currentPageRows, guards), filter),
		[currentPageRows, guards, filter]
	);

	/**
	 * Torbox rows with no verdict on this page.
	 *
	 * Counted from the raw page rather than the visible rows, because an unknown
	 * row is exactly the one the guard withholds — counting what is on screen
	 * would always be zero and the footer would claim the probe was complete.
	 */
	const unknownCount = useMemo(
		() => currentPageRows.filter((r) => r.state === 'unknown').length,
		[currentPageRows]
	);

	/** Marks one row's `added` flag without disturbing the rest of the page. */
	const markAdded = useCallback((hash: string, added: boolean) => {
		setPageRows((prev) => {
			const next = new Map<number, GridRow[]>();
			for (const [page, list] of prev) {
				next.set(
					page,
					list.map((r) => (r.hash === hash ? { ...r, added } : r))
				);
			}
			return next;
		});
	}, []);

	const performAdd = useCallback(
		async (row: GridRow) => {
			setAdding((prev) => new Set(prev).add(row.hash));
			try {
				// Paced: Torbox refuses a burst, and two adds landing together
				// would both be refused rather than one queued behind the other.
				const outcome = await pacedAdd(() =>
					addTorrent(config.torboxApiKey, row.hash, {
						apiBase: config.torboxApiBase,
						verify: config.verifyAdds,
					})
				);
				if (outcome.ok) {
					markAdded(row.hash, true);
					setStatus({
						text:
							outcome.verificationWarning ??
							`Added to Torbox${outcome.queued ? ' (queued)' : ''}.`,
						kind: outcome.verificationWarning ? 'warn' : 'info',
					});
				} else {
					setStatus({ text: outcome.message, kind: 'error' });
				}
			} catch (error) {
				setStatus({
					text: error instanceof Error ? error.message : String(error),
					kind: 'error',
				});
			} finally {
				setAdding((prev) => {
					const next = new Set(prev);
					next.delete(row.hash);
					return next;
				});
			}
		},
		[config.torboxApiBase, config.torboxApiKey, config.verifyAdds, markAdded]
	);

	/**
	 * What `a` does on a given row.
	 *
	 * The guards are consulted here rather than assumed from what is on screen, so
	 * that a row revealed by a toggle is still refused when the toggle is off —
	 * and an archive stays refused even when archives are shown, because adding one
	 * yields something to unpack.
	 */
	/**
	 * Applies `decideAdd`. All the judgement about what `a` means lives in that
	 * pure function; this only turns its answer into a screen or a message.
	 */
	const requestAdd = useCallback(
		(row: GridRow | undefined) => {
			const decision = decideAdd(row, guards, adding);
			switch (decision.action) {
				case 'add':
					if (row) void performAdd(row);
					return;
				case 'confirm':
					if (row) setConfirming(row);
					return;
				case 'refuse':
					setStatus({ text: decision.message, kind: 'warn' });
			}
		},
		[adding, guards, performAdd]
	);

	const changeSeason = useCallback(
		(delta: number) => {
			if (!seasons.length || season === undefined) return;
			const at = seasons.indexOf(season);
			const next = seasons[Math.min(Math.max(0, at + delta), seasons.length - 1)];
			if (next === undefined || next === season) return;
			const title = titles.find((t) => t.type === 'show');
			if (!title) return;
			setSeason(next);
			// Another season is another release set, so the pages held are its
			// predecessor's and would show releases from the wrong season.
			resetPages();
			void loadGrid(title, next);
		},
		[loadGrid, resetPages, season, seasons, titles]
	);

	/**
	 * The `/` filter line.
	 *
	 * Applies as you type rather than on enter, so the list narrows under the
	 * cursor instead of after a second keystroke. Esc restores what was there when
	 * `/` was pressed, because a filter that cannot be taken back is a trap rather
	 * than a tool.
	 */
	useInput((input, key) => {
		if (!filtering) return;
		if (key.escape) {
			setFilter(filterBeforeOpen);
			setFiltering(false);
			setStatus(NO_STATUS);
			return;
		}
		if (key.return) {
			setFiltering(false);
			return;
		}
		if (key.backspace || key.delete) {
			setFilter((f) => f.slice(0, -1));
			return;
		}
		if (input && !key.ctrl && !key.meta) setFilter((f) => f + input);
	});

	const openFilter = useCallback(() => {
		setFilterBeforeOpen(filter);
		setFiltering(true);
	}, [filter]);

	/**
	 * `[` and `]`.
	 *
	 * Backward never asks DMM again. Forward does only when the next page has not
	 * been fetched, which is the only path here that spends the rate limit.
	 */
	const changePage = useCallback(
		(direction: -1 | 1) => {
			const move = planPageMove(paging, direction);
			if (move.action === 'stay') return;
			if (move.action === 'move') {
				setPaging((prev) => ({ ...prev, page: move.page }));
				setSelected(0);
				setStatus(NO_STATUS);
				return;
			}
			if (currentTitle) void loadGrid(currentTitle, season, move.page);
		},
		[currentTitle, loadGrid, paging, season]
	);

	/**
	 * `y` — the hash, to paste somewhere.
	 *
	 * Sent as an OSC 52 escape, which tmux and many emulators refuse without
	 * saying so, so the status always repeats the hash on screen too. It cannot
	 * claim success and does not.
	 */
	const copySelectedHash = useCallback(() => {
		const row = rows[Math.min(selected, Math.max(0, rows.length - 1))];
		if (!row) return;
		sendToClipboard(row.hash);
		setStatus({ text: describeCopy(row.hash, false), kind: 'info' });
	}, [rows, selected]);

	/**
	 * Why the grid is empty, when it is.
	 *
	 * Only the filter is blamed when the page actually had rows before filtering.
	 * An empty page and an over-narrow filter look identical on screen otherwise,
	 * and sending someone to fix their filter when the real answer is "this DMM has
	 * nothing for that title" wastes their time and teaches them the messages are noise.
	 */
	const statusText = useMemo(() => {
		if (status?.text) return status.text;
		if (filter.trim() && rows.length === 0 && currentPageRows.length > 0) {
			return describeEmptyFilter(filter);
		}
		return '';
	}, [currentPageRows.length, filter, rows.length, status]);

	const emptyMessage = useMemo(() => {
		if (filter.trim() && rows.length === 0 && currentPageRows.length > 0) {
			return `nothing on this page matches "${filter.trim()}" — esc clears it`;
		}
		if (currentPageRows.length === 0) return 'nothing to show — press esc to go back';
		return 'nothing to show — press u to include uncached releases';
	}, [currentPageRows.length, filter, rows.length]);

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
						if (title) {
							resetPages();
							setFilter('');
							void loadGrid(title);
						} else void runSearch();
					}}
					busy={busy}
					searched={searched}
					status={status?.text ?? ''}
					directId={asImdbId(query)}
				/>
			</Box>
		);
	}

	if (viewingFiles) {
		return (
			<Box flexDirection="column">
				<FileListModal
					colour={colour}
					files={probeFiles.get(viewingFiles.hash) ?? []}
					width={terminalWidth}
					onClose={() => setViewingFiles(null)}
				/>
			</Box>
		);
	}

	if (confirming) {
		return (
			<Box flexDirection="column">
				<ConfirmScreen
					colour={colour}
					row={confirming}
					onConfirm={() => {
						const row = confirming;
						setConfirming(null);
						void performAdd(row);
					}}
					onCancel={() => setConfirming(null)}
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
				onSelect={(index) => {
					setSelected(index);
					// "Added to Torbox." belongs to the row it describes. Left up
					// after a move it reads as a claim about whatever is now
					// selected, which is a different release.
					setStatus(NO_STATUS);
				}}
				width={terminalWidth}
				height={terminalHeight}
				expectedEpisodes={expected}
				emptyMessage={emptyMessage}
				busy={busy}
				onBack={() => {
					setScreen('search');
					setStatus(NO_STATUS);
				}}
				onToggleUncached={() => {
					setGuards((g) => ({ ...g, showUncached: !g.showUncached }));
					setStatus(NO_STATUS);
				}}
				onToggleArchives={() => {
					setGuards((g) => ({ ...g, showArchiveOnly: !g.showArchiveOnly }));
					setStatus(NO_STATUS);
				}}
				onSeason={changeSeason}
				onRetry={() => {
					// Re-fetches the releases *and* re-probes Torbox for this page,
					// which is what both "it says not scraped, try again" and "the
					// cache answers changed" need. Cached pages behind it are kept.
					if (currentTitle) void loadGrid(currentTitle, season, paging.page);
				}}
				onFilter={openFilter}
				onPage={changePage}
				onCopyHash={copySelectedHash}
				filterFocused={filtering}
				onAdd={() => requestAdd(rows[Math.min(selected, Math.max(0, rows.length - 1))])}
				adding={adding}
				onShowFiles={() => {
					const row = rows[Math.min(selected, Math.max(0, rows.length - 1))];
					if (row) setViewingFiles(row);
				}}
				onQuit={() => {
					onQuit();
					exit();
				}}
			/>
			<Footer
				colour={colour}
				filter={filter || (filtering ? '' : config.defaultFilter)}
				filterFocused={filtering}
				unknownCount={unknownCount}
				shown={rows.length}
				total={currentPageRows.length}
				paging={describePaging(paging)}
				status={statusText}
				statusKind={status?.kind ?? 'info'}
				keys={
					`a add · y hash · / filter · [ ] page (${describePaging(paging)}) · ` +
					`r refresh · u ${guards.showUncached ? 'hide' : 'show'} uncached · ` +
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
