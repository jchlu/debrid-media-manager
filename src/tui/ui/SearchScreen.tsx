import type { Title } from '@/tui/dmm/titles';
import { type Palette } from '@/tui/ui/theme';
import { Box, Text, useInput } from 'ink';

/**
 * The title picker.
 *
 * Shows what Trakt returned, in the order it returned it. Nothing is curated
 * away: a search for "breaking bad" also returns El Camino and a making-of, and
 * the browser shows those too. Hiding them would be a guess about which one the
 * user meant.
 */
export type SearchScreenProps = {
	colour: Palette;
	query: string;
	onQuery: (value: string) => void;
	titles: Title[];
	selected: number;
	onSelect: (index: number) => void;
	onSubmit: () => void;
	busy: boolean;
	/** Whether a search has run for the current query. */
	searched: boolean;
	status: string;
	/** Set when the query is already an IMDb id and the search is skipped. */
	directId?: string;
};

const TYPE_LABEL: Record<Title['type'], string> = {
	movie: 'MOVIE',
	show: 'SHOW',
};

export default function SearchScreen(props: SearchScreenProps) {
	const {
		colour,
		query,
		onQuery,
		titles,
		selected,
		onSelect,
		onSubmit,
		busy,
		searched,
		status,
		directId,
	} = props;

	useInput((input, key) => {
		if (key.upArrow) return onSelect(Math.max(0, selected - 1));
		if (key.downArrow) return onSelect(Math.min(titles.length - 1, selected + 1));
		if (key.return) return onSubmit();
		if (key.ctrl && input === 'c') {
			// Ink's own Ctrl-C handling is off, so it is handled by the caller.
			return;
		}
		if (key.backspace || key.delete) return onQuery(query.slice(0, -1));
		if (input && !key.ctrl && !key.meta) onQuery(query + input);
	});

	return (
		<Box flexDirection="column">
			<Box>
				<Text bold color={colour.accent}>
					dmm-tui
				</Text>
				<Text color={colour.dim}> — search a title to add to Torbox</Text>
			</Box>
			<Box marginTop={1}>
				<Text color={colour.dim}>{'> '}</Text>
				<Text>{query}</Text>
				<Text color={colour.accent}>▏</Text>
			</Box>

			{directId ? (
				<Box marginTop={1}>
					<Text color={colour.dim}>{`"${directId}" is an IMDb id — press Enter.`}</Text>
				</Box>
			) : null}

			{busy ? (
				<Box marginTop={1}>
					<Text color={colour.dim}>searching…</Text>
				</Box>
			) : null}

			{!busy && !directId && searched && titles.length === 0 ? (
				<Box marginTop={1}>
					<Text color={colour.dim}>nothing found</Text>
				</Box>
			) : null}

			{!busy && !searched && !directId && query.trim() ? (
				<Box marginTop={1}>
					<Text color={colour.dim}>press Enter to search</Text>
				</Box>
			) : null}

			<Box flexDirection="column" marginTop={1}>
				{titles.map((title, index) => (
					<Box key={title.imdbid}>
						<Text color={index === selected ? colour.selected : colour.dim}>
							{index === selected ? '▸' : ' '}
						</Text>
						<Text color={index === selected ? colour.selected : undefined}>
							{`[${TYPE_LABEL[title.type].padEnd(5)}] ${title.title}`}
						</Text>
						<Text color={colour.dim}>{title.year ? `  (${title.year})` : ''}</Text>
					</Box>
				))}
			</Box>

			{status ? (
				<Box marginTop={1}>
					<Text color={colour.warn}>{status}</Text>
				</Box>
			) : null}

			<Box marginTop={1}>
				<Text color={colour.dim}>↑↓ choose · enter open · ctrl-c quit</Text>
			</Box>
		</Box>
	);
}
