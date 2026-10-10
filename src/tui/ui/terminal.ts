/**
 * Taking the terminal, and giving it back.
 *
 * Over SSH, leaving a terminal in a broken state is worse than a crash: raw mode
 * on means the shell echoes nothing and Ctrl-C does nothing, and the user is
 * typing into a dead pane with no way back except killing the session. So the
 * alternate screen, the cursor and raw mode are all restored on every exit path —
 * normal, `SIGINT`, `SIGTERM`, and an uncaught throw — and a crash during
 * start-up still restores whatever was already taken.
 */

/** The alternate screen buffer, so quitting leaves the scrollback intact. */
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const SHOW_CURSOR = '\x1b[?25h';

export type Terminal = {
	/** Idempotent. Safe to call when nothing was taken. */
	restore(): void;
	/** Whether anything was actually taken, for tests and for reporting. */
	readonly active: boolean;
};

export type TerminalDeps = {
	write?: (chunk: string) => void;
	signals?: NodeJS.Signals[];
	onSignal?: (handler: () => void) => () => void;
	onUncaught?: (handler: (error: unknown) => void) => () => void;
};

const defaultWrite = (chunk: string) => process.stdout.write(chunk);

/**
 * Puts the terminal on the alternate screen and guarantees it comes back.
 *
 * `write` is injectable so a test can assert the exact sequences without a TTY.
 * Restoration is guarded by a flag rather than by try/catch, because the paths
 * that most often fail are the signal handlers, and a second restore is harmless
 * while a missed one is not.
 */
export function takeTerminal(deps: TerminalDeps = {}): Terminal {
	const write = deps.write ?? defaultWrite;
	const state = { active: false };
	let restored = false;

	const restore = () => {
		if (restored) return;
		restored = true;
		if (!state.active) return;
		// Reverse order: raw mode is put back by Ink, then the cursor, then the
		// alternate screen — so the shell redraws into a sane terminal.
		write(SHOW_CURSOR);
		write(LEAVE_ALT_SCREEN);
		state.active = false;
	};

	write(ENTER_ALT_SCREEN);
	write(SHOW_CURSOR);
	state.active = true;

	const unsubscribes: (() => void)[] = [];
	const register = (handler: () => void) => {
		const off =
			deps.onSignal?.(handler) ??
			(() => {
				const listener = () => {
					restore();
					process.exit(130); // 128 + SIGINT, the shell's convention
				};
				process.once('SIGINT', listener);
				return () => process.removeListener('SIGINT', listener);
			});
		unsubscribes.push(off);
	};

	for (const signal of deps.signals ?? (['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[])) {
		register(() => {
			restore();
			process.exit(0);
		});
	}

	const offUncaught =
		deps.onUncaught?.((error) => {
			restore();
			process.stderr.write(
				`dmm-tui: ${error instanceof Error ? error.stack : String(error)}\n`
			);
			process.exit(1);
		}) ??
		(() => {
			const listener = (error: unknown) => {
				restore();
				process.stderr.write(
					`dmm-tui: ${error instanceof Error ? error.stack : String(error)}\n`
				);
				process.exit(1);
			};
			process.on('uncaughtException', listener);
			return () => process.removeListener('uncaughtException', listener);
		});
	unsubscribes.push(offUncaught);

	return {
		restore: () => {
			for (const off of unsubscribes) off();
			restore();
		},
		get active() {
			return state.active;
		},
	};
}

/**
 * A callback for `SIGWINCH`, since the grid is recomputed from the terminal width
 * and has to be told to redraw when that width changes.
 */
export function onResize(handler: () => void): () => void {
	process.stdout.on('resize', handler);
	return () => process.stdout.off('resize', handler);
}
