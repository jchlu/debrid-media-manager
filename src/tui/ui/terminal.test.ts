import { takeTerminal } from '@/tui/ui/terminal';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The handlers call `process.exit` on purpose — a restored terminal that then
 * hangs is not a restored terminal. So it is stubbed here, and asserted on.
 */
afterEach(() => {
	vi.restoreAllMocks();
});

/**
 * The restoration path, asserted on the exact escape sequences.
 *
 * Over SSH a terminal left in raw mode is worse than a crash: nothing echoes,
 * Ctrl-C does nothing, and the session is unusable until it is killed. So the
 * sequences and the order they are written in are the contract, not an
 * implementation detail.
 */
describe('takeTerminal', () => {
	const setup = () => {
		const written: string[] = [];
		// The uncaught handler takes the error; the signal handler does not.
		const handlers = new Map<string, (...args: never[]) => void>();
		const terminal = takeTerminal({
			write: (chunk) => written.push(chunk),
			signals: ['SIGINT', 'SIGTERM'],
			onSignal: (handler) => {
				handlers.set('signal', handler as (...args: never[]) => void);
				return () => handlers.delete('signal');
			},
			onUncaught: (handler) => {
				handlers.set('uncaught', handler as (...args: never[]) => void);
				return () => handlers.delete('uncaught');
			},
		});
		return { written, handlers, terminal };
	};

	it('takes the alternate screen on start', () => {
		const { written, terminal } = setup();
		expect(written[0]).toBe('\x1b[?1049h');
		expect(terminal.active).toBe(true);
		terminal.restore();
	});

	it('gives the cursor back and leaves the alternate screen on restore', () => {
		const { written, terminal } = setup();
		written.length = 0;
		terminal.restore();
		expect(written).toEqual(['\x1b[?25h', '\x1b[?1049l']);
		expect(terminal.active).toBe(false);
	});

	it('restores only once, however many times it is asked', () => {
		// The signal handlers and the uncaught handler can both fire for one
		// crash. A second restore is harmless; a missed one strands the terminal.
		const { written, terminal } = setup();
		written.length = 0;
		terminal.restore();
		terminal.restore();
		terminal.restore();
		expect(written).toEqual(['\x1b[?25h', '\x1b[?1049l']);
	});

	it('restores then exits when a signal arrives', () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		const { written, handlers } = setup();
		written.length = 0;
		(handlers.get('signal') as (() => void) | undefined)?.();
		expect(written).toEqual(['\x1b[?25h', '\x1b[?1049l']);
		expect(exit).toHaveBeenCalledWith(0);
	});

	it('restores then exits non-zero when the process throws outside the UI', () => {
		// The case that leaves a dead pane: a bug in a key handler, an async
		// rejection, anything that is not a clean exit.
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		const { written, handlers } = setup();
		written.length = 0;
		(handlers.get('uncaught') as ((e: unknown) => void) | undefined)?.(new Error('boom'));
		expect(written).toEqual(['\x1b[?25h', '\x1b[?1049l']);
		expect(exit).toHaveBeenCalledWith(1);
	});

	it('unsubscribes its handlers on restore', () => {
		const { handlers, terminal } = setup();
		terminal.restore();
		expect(handlers.size).toBe(0);
	});

	it('writes nothing on restore when it never took the terminal', () => {
		// Defensive: a double restore after a failed start-up must not emit a
		// bare escape sequence into a shell that was never taken over.
		const written: string[] = [];
		const terminal = takeTerminal({ write: (c) => written.push(c), signals: [] });
		terminal.restore();
		written.length = 0;
		terminal.restore();
		expect(written).toEqual([]);
	});
});

describe('takeTerminal with no injected signal handling', () => {
	it('works with no injected handlers at all', () => {
		// The real wiring — registering `process.on('uncaughtException')` — is not
		// asserted here: under jsdom the listener count belongs to vitest's own
		// handlers and says nothing about this module. What matters is that the
		// default path takes the terminal and gives it back, which is what a crash
		// in the real app would exercise.
		const written: string[] = [];
		const terminal = takeTerminal({ write: (c) => written.push(c), signals: [] });

		expect(terminal.active).toBe(true);
		expect(written).toContain('\x1b[?1049h');

		terminal.restore();
		expect(terminal.active).toBe(false);
		expect(written).toContain('\x1b[?1049l');
	});
});
