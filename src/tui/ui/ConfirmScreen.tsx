import { confirmSummary } from '@/tui/logic/addRequest';
import type { GridRow } from '@/tui/logic/types';
import type { Palette } from '@/tui/ui/theme';
import { Box, Text, useInput } from 'ink';

/**
 * Confirmation before an add that costs something.
 *
 * Shown only for a row that is not already cached. Cached rows add on the key
 * press itself — an extra keystroke on every free action trains people to press
 * through dialogs, which is the opposite of what the dialog is for.
 *
 * The cost is stated in the user's terms, not the provider's: a paid Torbox plan
 * spends points and bandwidth seeding a release nobody else has, and this is the
 * last screen before that happens.
 */
export type ConfirmScreenProps = {
	colour: Palette;
	row: GridRow;
	onConfirm: () => void;
	onCancel: () => void;
};

const stateWords: Record<GridRow['state'], string> = {
	instant: 'Torbox already holds this release, so it is available immediately.',
	uncached:
		'Torbox does not hold this release. It will download and seed it, which spends Torbox points and your bandwidth.',
	archive: 'Torbox holds this release as one archive, so there is nothing playable to add.',
	unknown: 'Torbox gave no answer about this release, so nothing is known about it.',
};

export default function ConfirmScreen({ colour, row, onConfirm, onCancel }: ConfirmScreenProps) {
	useInput((input, key) => {
		if (key.escape || input === 'n' || input === 'q') return onCancel();
		if (input === 'y') return onConfirm();
	});

	const cost = row.state !== 'instant';

	return (
		<Box flexDirection="column">
			<Box>
				<Text bold color={colour.accent}>
					Add to Torbox?
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text>{row.title}</Text>
				<Text color={colour.dim}>{confirmSummary(row)}</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={cost ? colour.warn : colour.cached}>{stateWords[row.state]}</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colour.dim}>y confirm · n or esc cancel</Text>
			</Box>
		</Box>
	);
}
