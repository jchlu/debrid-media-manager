import { cellStart, cellTail } from '@/tui/logic/table';
import type { ProbeFile } from '@/tui/torbox/probe';
import type { Palette } from '@/tui/ui/theme';
import { isVideo } from '@/utils/selectable';
import { Box, Text, useInput } from 'ink';

/**
 * The files inside one release, as Torbox lists them.
 *
 * Read straight from the probe's own listing, so it shows what Torbox actually
 * holds rather than what the release name promises. File ids come from the
 * response and are never the array position: 50 of 52 files across four season
 * packs mismatched when that was measured
 * (`src/utils/instantChecks.ts:343-347`).
 */
export type FileListModalProps = {
	colour: Palette;
	files: ProbeFile[];
	width: number;
	onClose: () => void;
};

const NAME_WIDTH = 64;
const SIZE_WIDTH = 12;

export function describeFiles(files: ProbeFile[]): string[] {
	const playable = files.filter((f) => isVideo({ path: f.name }));
	const others = files.length - playable.length;
	if (files.length === 0) return ['Torbox listed no files for this release.'];
	const parts = [`${playable.length} playable`, `${others} other`];
	return [`${files.length} file(s): ${parts.join(' · ')}`];
}

export default function FileListModal({ colour, files, width, onClose }: FileListModalProps) {
	useInput((_input, key) => {
		if (key.escape || key.return) onClose();
	});

	const nameWidth = Math.max(16, Math.min(NAME_WIDTH, width - SIZE_WIDTH - 8));
	const height = 12;

	// Largest first, which is how a season pack's "which file do I watch"
	// question is usually answered.
	const sorted = [...files].sort((a, b) => b.size - a.size);
	const shown = sorted.slice(0, height - 5);
	const hidden = sorted.length - shown.length;

	return (
		<Box flexDirection="column">
			<Box>
				<Text bold color={colour.accent}>
					Files
				</Text>
				<Text color={colour.dim}>{describeFiles(files)[0]}</Text>
			</Box>
			<Box marginTop={1}>
				<Text color={colour.dim}>
					{cellStart('SIZE', SIZE_WIDTH) + cellTail('NAME', nameWidth)}
				</Text>
			</Box>
			{files.length === 0 ? (
				<Box marginTop={1}>
					<Text color={colour.warn}>Torbox listed no files for this release.</Text>
				</Box>
			) : null}
			{shown.map((file) => (
				<Box key={`${file.id}-${file.name}`}>
					<Text color={isVideo({ path: file.name }) ? undefined : colour.dim}>
						{cellStart(`${(file.size / 1024 / 1024).toFixed(0)} MB`, SIZE_WIDTH) +
							cellTail(file.name, nameWidth)}
					</Text>
				</Box>
			))}
			{hidden > 0 ? (
				<Box>
					<Text color={colour.dim}>{`… and ${hidden} more`}</Text>
				</Box>
			) : null}
			<Box marginTop={1}>
				<Text color={colour.dim}>esc close</Text>
			</Box>
		</Box>
	);
}
