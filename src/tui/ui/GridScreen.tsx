import { MIN_GRID_WIDTH, MIN_TITLE_WIDTH, renderRow } from '@/tui/logic/table';
import type { GridRow } from '@/tui/logic/types';
import { MIN_USABLE_WIDTH, type Palette } from '@/tui/ui/theme';
import { Box, Text, useInput } from 'ink';

/**
 * The grid.
 *
 * Holds no data and makes no decisions: the rows arrive already filtered and
 * sorted by `logic/normalise`, and every line is computed by the pure renderer in
 * `logic/table.ts`. What lives here is navigation and the keys that change state
 * the renderer does not know about.
 */
export type GridScreenProps = {
	colour: Palette;
	title: string;
	/** Season number, when this is a show. */
	season?: number;
	seasons?: number[];
	rows: GridRow[];
	selected: number;
	onSelect: (index: number) => void;
	width: number;
	height: number;
	expectedEpisodes?: number;
	/** Says why the grid is empty, since "nothing" is not an answer. */
	emptyMessage: string;
	busy: boolean;
	onBack: () => void;
	onToggleUncached: () => void;
	onToggleArchives: () => void;
	onSeason: (delta: number) => void;
	onAdd: () => void;
	onShowFiles: () => void;
	/** Rows mid-add, so they read as in-flight rather than simply selectable. */
	adding: Set<string>;
	/** Re-run the search and probe for this title and page. */
	onRetry: () => void;
	/** Open the `/` filter line. */
	onFilter: () => void;
	/** `[` and `]`. Paging back is free; paging forward may spend a request. */
	onPage: (direction: -1 | 1) => void;
	/** `y` — send the selected hash to the terminal clipboard. */
	onCopyHash: () => void;
	/** While true, the filter line owns the keyboard. */
	filterFocused: boolean;
	onQuit: () => void;
};

export default function GridScreen(props: GridScreenProps) {
	const {
		colour,
		title,
		season,
		seasons,
		rows,
		selected,
		onSelect,
		width,
		height,
		expectedEpisodes,
		emptyMessage,
		busy,
		onBack,
		onToggleUncached,
		onToggleArchives,
		onSeason,
		onAdd,
		onShowFiles,
		adding,
		onRetry,
		onFilter,
		onPage,
		onCopyHash,
		filterFocused,
		onQuit,
	} = props;

	// Suspended while the filter line is open: two `useInput` handlers both acting
	// on one keystroke means typing `a` into a filter also adds the selected row.
	useInput(
		(input, key) => {
			if (key.ctrl && input === 'c') return onQuit();
			if (key.escape) return onBack();
			if (busy) return;
			if (key.upArrow || (key.ctrl && input === 'p'))
				return onSelect(Math.max(0, selected - 1));
			if (key.downArrow || (key.ctrl && input === 'n')) {
				return onSelect(Math.min(rows.length - 1, selected + 1));
			}
			if (key.pageUp) return onSelect(Math.max(0, selected - (height - 3)));
			if (key.pageDown) return onSelect(Math.min(rows.length - 1, selected + (height - 3)));
			if (key.home) return onSelect(0);
			if (key.end) return onSelect(rows.length - 1);
			if (input === '/') return onFilter();
			if (input === '[') return onPage(-1);
			if (input === ']') return onPage(1);
			if (input === 'r') return onRetry();
			if (input === 'u') return onToggleUncached();
			if (input === 'z') return onToggleArchives();
			if (input === 'a') return onAdd();
			if (input === 'y') return onCopyHash();
			if (key.return) return onShowFiles();
			if (input === '<') return onSeason(-1);
			if (input === '>') return onSeason(1);
		},
		{ isActive: !filterFocused }
	);

	if (width < MIN_USABLE_WIDTH) {
		return (
			<Box flexDirection="column">
				<Text color={colour.warn}>
					{`Terminal is ${width} columns wide; dmm-tui needs at least ${MIN_USABLE_WIDTH}.`}
				</Text>
				<Text color={colour.dim}>
					{'Widen the pane, or detach tmux to get a larger one.'}
				</Text>
			</Box>
		);
	}

	const gridWidth = Math.min(width, 200);
	// Two lines of header, one of footer legend, so the window is what is left.
	const gridHeight = Math.max(1, height - 5);
	const lines = rows.map((row, index) =>
		renderRow(row, { width: gridWidth, selected: index === selected, expectedEpisodes })
	);
	const visible = Math.max(0, Math.min(gridHeight, rows.length));
	const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), rows.length - visible));

	const stateColour = (row: GridRow) =>
		row.state === 'instant'
			? colour.cached
			: row.state === 'archive'
				? colour.archive
				: colour.uncached;

	return (
		<Box flexDirection="column">
			<Box>
				<Text bold color={colour.accent}>
					{title}
				</Text>
				{season !== undefined ? (
					<Text color={colour.dim}>{`  season ${season}`}</Text>
				) : null}
				<Text
					color={colour.dim}
				>{`  ${Math.min(selected + 1, rows.length)} of ${rows.length}`}</Text>
				<Text color={colour.dim}>{seasons?.length ? '  < > season' : ''}</Text>
			</Box>

			{busy ? (
				<Box>
					<Text color={colour.dim}>loading…</Text>
				</Box>
			) : null}

			{!busy && rows.length === 0 ? (
				<Box>
					<Text color={colour.dim}>{emptyMessage}</Text>
				</Box>
			) : null}

			<Box flexDirection="column">
				{lines.slice(start, start + visible).map((line, offset) => {
					const row = rows[start + offset];
					const isSelected = start + offset === selected;
					return (
						<Text
							key={row.hash}
							color={isSelected ? colour.selected : stateColour(row)}
						>
							{line}
						</Text>
					);
				})}
			</Box>
		</Box>
	);
}

export { MIN_GRID_WIDTH, MIN_TITLE_WIDTH };
