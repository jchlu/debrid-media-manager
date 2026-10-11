import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Terminal restoration, proven against a real process and a real signal.
 *
 * The injected-writer tests in `terminal.test.ts` cover what happens when a
 * handler runs. They cannot cover whether a handler was registered for the
 * signal that actually arrives, and they never covered it: `takeTerminal`'s
 * default branches defined their `process.once` listeners inside an arrow
 * function that was never invoked, so no signal and no `uncaughtException`
 * handler existed. Every test here would have failed.
 *
 * The runner is `node --import tsx` because that is what `npm run tui` uses, and
 * it is not interchangeable with the `tsx` CLI: the CLI installs its own SIGHUP
 * handling and the process dies before any application listener runs, which
 * leaves the terminal exactly where this file exists to prevent.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HARNESS = path.resolve(__dirname, '__fixtures__/terminalHarness.ts');

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const SHOW_CURSOR = '\x1b[?25h';

type Run = { code: number; signal: NodeJS.Signals | null; stdout: string };

/** Spawns the harness, waits for it to take the terminal, signals it, collects output. */
function runHarness(signal: NodeJS.Signals, ms = 60_000): Promise<Run> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--import', 'tsx', HARNESS], {
			cwd: REPO_ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, TSX_TSCONFIG_PATH: 'src/tui/tsconfig.json' },
		});

		let stdout = '';
		let stderr = '';
		let signalled = false;

		child.stdout.on('data', (c: Buffer) => {
			stdout += c.toString('utf8');
		});
		// Once it says READY the terminal is genuinely taken. Signalling earlier
		// would test a process that had not started yet.
		child.stderr.on('data', (c: Buffer) => {
			stderr += c.toString('utf8');
			if (stderr.includes('READY') && !signalled) {
				signalled = true;
				child.kill(signal);
			}
		});

		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`harness never became ready. stderr: ${stderr}`));
		}, ms);

		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('exit', (code, sig) => {
			clearTimeout(timer);
			resolve({ code: code ?? -1, signal: sig, stdout });
		});
	});
}

const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

describe('terminal restoration under a real signal', () => {
	it.each(SIGNALS)(
		'gives the terminal back on %s',
		async (signal) => {
			const { stdout } = await runHarness(signal);

			// Took the alternate screen…
			expect(stdout).toContain(ENTER_ALT_SCREEN);
			// …and put it back. Without this the pane is left where the shell cannot
			// draw, which over SSH means no prompt and no obvious way back.
			expect(stdout).toContain(SHOW_CURSOR);
			expect(stdout).toContain(LEAVE_ALT_SCREEN);
			// Order matters: the cursor is restored before leaving the alternate
			// screen, so the shell redraws into a sane terminal.
			expect(stdout.indexOf(SHOW_CURSOR)).toBeLessThan(stdout.indexOf(LEAVE_ALT_SCREEN));
		},
		90_000
	);

	it.each(SIGNALS)(
		'handles %s rather than dying on Node’s default',
		async (signal) => {
			const { signal: diedOn } = await runHarness(signal);
			// An unhandled signal terminates the process by default, which looks like a
			// clean exit in a status code and is why the restoration assertion above is
			// the one that actually discriminates.
			expect(diedOn).toBeNull();
		},
		90_000
	);
});

describe('the runner the app actually ships with', () => {
	it('is the one this test exercises', () => {
		// If `npm run tui` goes back to the `tsx` CLI, SIGHUP stops being
		// catchable and this test would keep passing while the guarantee is gone.
		// Cheap insurance against exactly that.
		const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
		expect(pkg.scripts.tui).toContain('node --import tsx');
		expect(pkg.scripts.tui).not.toMatch(/^\s*tsx\s/);
	});
});
