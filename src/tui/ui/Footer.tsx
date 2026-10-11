import { type Palette } from '@/tui/ui/theme';
import { Box, Text } from 'ink';

/**
 * The line under the grid.
 *
 * Carries three things that would otherwise be invisible: what the guards are
 * currently set to (because they decide what `a` will do), whether the last
 * Torbox probe was complete (because an incomplete probe means some rows are
 * being withheld), and the keys, because there is no help screen to press.
 */
export type FooterProps = {
	colour: Palette;
	/** The filter line, or a hint of how to start one. */
	filter: string;
	filterFocused: boolean;
	/** Rows Torbox gave no verdict on. Non-zero means the grid is partial. */
	unknownCount: number;
	shown: number;
	total: number;
	/** Which page of releases this is, and whether more follow. */
	paging: string;
	status: string;
	statusKind: 'info' | 'warn' | 'error';
	keys: string;
};

export default function Footer({
	colour,
	filter,
	filterFocused,
	unknownCount,
	shown,
	total,
	paging,
	status,
	statusKind,
	keys,
}: FooterProps) {
	const statusColour =
		statusKind === 'error' ? colour.error : statusKind === 'warn' ? colour.warn : colour.dim;

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box>
				<Text color={colour.dim}>filter: </Text>
				<Text color={filterFocused ? colour.accent : colour.dim}>
					{filter || (filterFocused ? '' : 'is:tb')}
				</Text>
				{filterFocused ? <Text color={colour.accent}>▏</Text> : null}
				<Text color={colour.dim}>
					{`   ${shown} shown${shown !== total ? ` of ${total}` : ''} · ${paging}`}
				</Text>
			</Box>

			{unknownCount > 0 ? (
				<Box>
					<Text color={colour.warn}>
						{`probe incomplete — ${unknownCount} row(s) got no verdict from Torbox`}
					</Text>
				</Box>
			) : null}

			{status ? (
				<Box>
					<Text color={statusColour}>{status}</Text>
				</Box>
			) : null}

			<Box>
				<Text color={colour.dim}>{keys}</Text>
			</Box>
		</Box>
	);
}
