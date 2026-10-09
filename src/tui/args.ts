/**
 * Command line for dmm-tui.
 *
 * Parsing is a pure function returning a discriminated union rather than a bag of
 * flags, so the entry point stays a thin `switch` and every accepted spelling is
 * testable without spawning a process. `--check-config` exists at all because
 * "my key is invalid" and "the key is fine but I typed the URL wrong" should be
 * separable without launching a UI.
 */

export type ParsedArgs =
	| { kind: 'help' }
	| { kind: 'check-config' }
	/** Runs the read pipeline and prints raw JSON. No UI, no writes. */
	| { kind: 'dump'; query: string }
	| { kind: 'interactive'; baseUrl?: string; query?: string };

/** A rejected command line. The message is printed verbatim, so it names the fix. */
export class ArgError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ArgError';
	}
}

const FLAGS_WITH_VALUE = new Set(['--base-url', '--query', '--dump']);

export const USAGE = `dmm-tui — search a title and add a release to your Torbox account

Usage:
  dmm-tui [options]

Options:
  -h, --help            Show this help and exit.
      --check-config    Validate the config file and the Torbox key, print a
                         redacted summary, and exit. Writes nothing.
      --base-url URL    Override the DMM base URL for this run.
      --query TITLE     Skip the search screen and open the grid for TITLE.
      --dump TITLE      Run the read pipeline for TITLE and print raw JSON.

Everything else comes from ~/.config/dmm-tui/config.json or the environment.`;

const needsValue = (flag: string) => `${flag} needs a value.`;

export function parseArgs(argv: string[]): ParsedArgs {
	// A flag wins over the default interactive mode, but two of them are not
	// meaningful together and silently picking one would hide a typo.
	let mode: 'help' | 'check-config' | 'dump' | null = null;
	let baseUrl: string | undefined;
	let query: string | undefined;
	let dumpQuery: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		// `--flag=value` alongside `--flag value`, because a base URL pasted
		// from a shell often arrives with its query string already attached.
		const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
		const flag = eq === -1 ? arg : arg.slice(0, eq);
		const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);

		switch (flag) {
			case '-h':
			case '--help':
				mode = 'help';
				break;
			case '--check-config':
				mode = mode === null ? 'check-config' : mode;
				break;
			case '--base-url':
				baseUrl = inlineValue ?? argv[++i];
				if (!baseUrl) throw new ArgError(needsValue(flag));
				break;
			case '--query':
				query = inlineValue ?? argv[++i];
				if (!query) throw new ArgError(needsValue(flag));
				break;
			case '--dump':
				mode = mode === null ? 'dump' : mode;
				dumpQuery = inlineValue ?? argv[++i];
				if (!dumpQuery) throw new ArgError(needsValue(flag));
				break;
			default:
				if (FLAGS_WITH_VALUE.has(arg)) {
					throw new ArgError(`${arg} needs a value.`);
				}
				throw new ArgError(`Unknown option "${arg}". Run dmm-tui --help.`);
		}
	}

	if (mode === 'help') return { kind: 'help' };
	if (mode === 'check-config') return { kind: 'check-config' };
	if (mode === 'dump') return { kind: 'dump', query: dumpQuery! };
	return baseUrl || query ? { kind: 'interactive', baseUrl, query } : { kind: 'interactive' };
}
