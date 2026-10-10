/**
 * Colour, and when not to use it.
 *
 * The grid runs over SSH into a box with no window manager, through tmux, on
 * whatever `$TERM` the terminal negotiated. Colour is decoration here and never
 * the only carrier of meaning: every state the grid shows also has a word
 * (`INSTANT`, `ARCHIVE`, `DL`), so a terminal that cannot render colour still
 * shows the truth.
 */

export type Palette = {
	accent: string;
	cached: string;
	archive: string;
	uncached: string;
	selected: string;
	dim: string;
	warn: string;
	error: string;
};

/**
 * Whether colour is worth emitting.
 *
 * `NO_COLOR` and a dumb terminal both win over everything, per
 * no-color.org. `FORCE_COLOR` overrides for a pipe or a screenshot. Otherwise
 * colour needs a TTY, which is false in a captured CI log — so nothing to read
 * there.
 */
export function colourEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
	const force = env.FORCE_COLOR;
	if (force !== undefined && force !== '' && force !== '0' && force !== 'false') return true;
	if (env.TERM === 'dumb') return false;
	return process.stdout.isTTY === true;
}

const TRUE_COLOUR: Palette = {
	accent: '#7dd3fc',
	cached: '#4ade80',
	archive: '#fbbf24',
	uncached: '#94a3b8',
	selected: '#e2e8f0',
	dim: '#64748b',
	warn: '#fbbf24',
	error: '#f87171',
};

/** The 16 ANSI names, which every terminal can render and no theme can lose. */
const BASIC: Palette = {
	accent: 'cyan',
	cached: 'green',
	archive: 'yellow',
	uncached: 'gray',
	selected: 'white',
	dim: 'gray',
	warn: 'yellow',
	error: 'red',
};

export const palette = (enabled: boolean): Palette => (enabled ? TRUE_COLOUR : BASIC);

/** Below this the grid is replaced by a single line, so the caller can say why. */
export const MIN_USABLE_WIDTH = 40;
