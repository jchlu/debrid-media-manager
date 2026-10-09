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
	| { kind: 'dump'; query: string; season?: number }
	| { kind: 'interactive'; baseUrl?: string; query?: string };

/** A rejected command line. The message is printed verbatim, so it names the fix. */
export class ArgError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ArgError';
	}
}

const FLAGS_WITH_VALUE = new Set(['--base-url', '--query', '--dump', '--season']);

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
      --season N        With --dump on a show, read season N instead of a movie.

Everything else comes from ~/.config/dmm-tui/config.json or the environment.`;

const needsValue = (flag: string) => `${flag} needs a value.`;

export function parseArgs(argv: string[]): ParsedArgs {
	// A flag wins over the default interactive mode, but two of them are not
	// meaningful together and silently picking one would hide a typo.
	let mode: 'help' | 'check-config' | 'dump' | null = null;
	let baseUrl: string | undefined;
	let query: string | undefined;
	let dumpQuery: string | undefined;
	let season: number | undefined;

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
			case '--season': {
				const raw = inlineValue ?? argv[++i];
				if (raw === undefined) throw new ArgError(needsValue(flag));
				// Rejected rather than coerced: season 0 is the specials bucket and
				// season "two" is a typo, and both would otherwise become NaN deep
				// inside a request that looks fine until DMM answers 400.
				season = Number(raw);
				if (!Number.isInteger(season) || season < 0) {
					throw new ArgError(
						`--season must be a whole number of 0 or more (got "${raw}").`
					);
				}
				break;
			}
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
	if (mode === 'dump') {
		return season === undefined
			? { kind: 'dump', query: dumpQuery! }
			: { kind: 'dump', query: dumpQuery!, season };
	}
	return baseUrl || query ? { kind: 'interactive', baseUrl, query } : { kind: 'interactive' };
}
