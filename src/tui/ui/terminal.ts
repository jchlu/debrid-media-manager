import fs from 'node:fs';
import os from 'node:os';

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
	/**
	 * How restoration reaches the terminal.
	 *
	 * Defaults to a synchronous write to fd 1, not to `write`. `process.stdout` is
	 * buffered when stdout is a pipe, and `process.exit` does not flush it — so a
	 * process that dies by signal can finish having restored *nothing*, which is
	 * the one case restoration exists for. A synchronous write is on the fd before
	 * the handler returns and cannot be lost to a buffer that never drains.
	 */
	writeSync?: (chunk: string) => void;
	signals?: NodeJS.Signals[];
	onSignal?: (handler: () => void) => () => void;
	onUncaught?: (handler: (error: unknown) => void) => () => void;
};

const defaultWrite = (chunk: string) => process.stdout.write(chunk);

const defaultSyncWrite = (chunk: string) => {
	try {
		fs.writeSync(1, chunk);
	} catch {
		// The descriptor is gone. There is no terminal left to hand back, and
		// throwing here would replace a clean exit with a stack trace.
	}
};

/** 128 + signum, which is how a shell reports a process killed by a signal. */
const exitCodeFor = (signal: NodeJS.Signals): number => 128 + (os.constants.signals[signal] ?? 0);

/**
 * Puts the terminal on the alternate screen and guarantees it comes back.
 *
 * `write` is injectable so a test can assert the exact sequences without a TTY.
 * Restoration is guarded by a flag rather than by try/catch, because the paths
 * that most often fail are the signal handlers, and a second restore is harmless
 * while a missed one is not.
 *
 * Both default branches are *invoked* immediately — they register the real
 * `process` listener and hand back its unsubscriber. Written as a bare arrow they
 * merely allocated a factory that nothing ever called, which left the module
 * registering no signal and no uncaught-exception handler at all: every caller
 * that injected its own hooks saw the working branch and never noticed. The
 * subprocess test is the only thing that could see it, because it is the only one
 * that runs the default path against a real signal.
 */
export function takeTerminal(deps: TerminalDeps = {}): Terminal {
	const write = deps.write ?? defaultWrite;
	// Falls back to `write` before the real default, so an injected `write` still
	// captures restoration and the unit tests keep asserting on the same writer.
	const writeSync = deps.writeSync ?? deps.write ?? defaultSyncWrite;
	const state = { active: false };
	let restored = false;

	const restore = () => {
		if (restored) return;
		restored = true;
		if (!state.active) return;
		// Reverse order: raw mode is put back by Ink, then the cursor, then the
		// alternate screen — so the shell redraws into a sane terminal.
		writeSync(SHOW_CURSOR);
		writeSync(LEAVE_ALT_SCREEN);
		state.active = false;
	};

	write(ENTER_ALT_SCREEN);
	write(SHOW_CURSOR);
	state.active = true;

	const unsubscribes: (() => void)[] = [];
	/**
	 * Listens for the signal it is given.
	 *
	 * This used to ignore its argument and always register `SIGINT`, so the loop
	 * over three signals installed three SIGINT listeners and none for SIGTERM or
	 * SIGHUP — and those two then took Node's default, which is death with no
	 * restoration at all. A `kill`, a stopped service or a dropped SSH connection
	 * is exactly the case this module promises to survive, and it survived none of
	 * them.
	 */
	const register = (signal: NodeJS.Signals, handler: () => void) => {
		const off =
			deps.onSignal?.(handler) ??
			(() => {
				const listener = () => {
					restore();
					process.exit(exitCodeFor(signal));
				};
				process.once(signal, listener);
				return () => process.removeListener(signal, listener);
			})();
		unsubscribes.push(off);
	};

	for (const signal of deps.signals ?? (['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[])) {
		register(signal, () => {
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
		})();
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
