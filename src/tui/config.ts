import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where dmm-tui gets its two required settings, and why the precedence is the
 * way it is.
 *
 * Environment beats file beats default. The file exists for the Debian box,
 * where the key is written once into `~/.config` and read by every shell over
 * SSH; the environment exists for the one-off `--base-url` and for CI. A default
 * for `dmmBaseUrl` would be a guess — DMM is deployed via Docker Swarm, so
 * whether the host reaches it on localhost, on a published port, or on the
 * overlay network is a fact about the deployment, not something to default.
 */

export type Config = {
	/** Root of the DMM instance to read from. No trailing slash. */
	dmmBaseUrl: string;
	torboxApiKey: string;
	/** Filter grammar applied to the grid on load. Same grammar as the web UI. */
	defaultFilter: string;
	/** Uncached rows are hidden until this is on. */
	showUncached: boolean;
	/** Archive-only rows are hidden until this is on. Separate from the filter
	 *  grammar, which has no token for it — `is:tb` reads availability only. */
	showArchiveOnly: boolean;
	/** Confirm a new torrent appears in `mylist` after adding. */
	verifyAdds: boolean;
	torboxApiBase: string;
};

/** A configuration problem. The message is printed verbatim, so it names the fix. */
export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

const DEFAULT_FILTER = 'is:tb';
const DEFAULT_TORBOX_API = 'https://api.torbox.app';

/** Filesystem and environment, injected so every branch is testable. */
export type LoadConfigDeps = {
	env?: Record<string, string | undefined>;
	/** Overrides config discovery. Tests point this at a fixture. */
	configPath?: string;
	readFile?: (path: string) => string;
	exists?: (path: string) => boolean;
	/** Permission bits, or `undefined` when the file cannot be stat'd. */
	mode?: (path: string) => number | undefined;
	homedir?: () => string;
	/** Collected rather than printed, so the caller decides where warnings go. */
	warn?: (message: string) => void;
};

const defaultDeps = (deps: LoadConfigDeps) => ({
	env: deps.env ?? process.env,
	readFile: deps.readFile ?? ((p: string) => readFileSync(p, 'utf-8')),
	exists: deps.exists ?? existsSync,
	mode:
		deps.mode ??
		((p: string) => {
			try {
				return statSync(p).mode & 0o777;
			} catch {
				return undefined;
			}
		}),
	homedir: deps.homedir ?? homedir,
	warn: deps.warn ?? ((message: string) => console.warn(message)),
});

/**
 * `$XDG_CONFIG_HOME/dmm-tui/config.json`, falling back to `~/.config`.
 *
 * XDG first because it is the standard and because it lets a second config live
 * beside the first for tests without touching the home directory.
 */
export function resolveConfigPath(deps: Pick<LoadConfigDeps, 'env' | 'homedir'> = {}): string {
	const env = deps.env ?? process.env;
	const home = (deps.homedir ?? homedir)();
	const base =
		env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
			? env.XDG_CONFIG_HOME
			: join(home, '.config');
	return join(base, 'dmm-tui', 'config.json');
}

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

/**
 * A boolean from the environment, or `undefined` to fall through to the default.
 *
 * Unrecognised values warn rather than silently meaning false: a typo in
 * `DMM_TUI_SHOW_UNCACHED=treu` must not read as "off" and quietly re-hide every
 * uncached row the user thought they had enabled.
 */
function envFlag(
	raw: string | undefined,
	fallback: boolean,
	name: string,
	warn: (m: string) => void
): boolean {
	if (raw === undefined || raw.trim() === '') return fallback;
	const value = raw.trim().toLowerCase();
	if (TRUE.has(value)) return true;
	if (FALSE.has(value)) return false;
	warn(`Ignoring ${name}="${raw}": expected one of true/false/1/0/yes/no.`);
	return fallback;
}

function normaliseBaseUrl(raw: string, source: string): string {
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (!/^https?:\/\//i.test(trimmed)) {
		throw new ConfigError(`${source} must start with http:// or https:// (got "${raw}").`);
	}
	try {
		// eslint-disable-next-line no-new
		new URL(trimmed);
	} catch {
		throw new ConfigError(`${source} is not a valid URL (got "${raw}").`);
	}
	return trimmed;
}

type RawConfig = Partial<Record<keyof Config, unknown>>;

function parseConfigFile(text: string, path: string, warn: (m: string) => void): RawConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new ConfigError(
			`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new ConfigError(`${path} must contain a JSON object.`);
	}
	const record = parsed as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!(key in DEFAULTS)) {
			warn(`Ignoring unknown setting "${key}" in ${path}.`);
		}
	}
	return record as RawConfig;
}

/** Every recognised key, with the value used when nothing supplies one. */
const DEFAULTS: Config = {
	dmmBaseUrl: '',
	torboxApiKey: '',
	defaultFilter: DEFAULT_FILTER,
	showUncached: false,
	showArchiveOnly: false,
	verifyAdds: true,
	torboxApiBase: DEFAULT_TORBOX_API,
};

const str = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export function loadConfig(
	overrides: { baseUrl?: string; apiKey?: string; requireTorboxKey?: boolean } = {},
	deps: LoadConfigDeps = {}
): Config {
	const d = defaultDeps(deps);
	const path = deps.configPath ?? resolveConfigPath({ env: d.env, homedir: d.homedir });
	const warnings: string[] = [];
	const warn = (m: string) => {
		warnings.push(m);
		d.warn(m);
	};

	let file: RawConfig = {};
	if (d.exists(path)) {
		const mode = d.mode(path);
		// A key readable by anyone else is a warning, not a refusal: refusing
		// would strand a user whose umask produced 0644 and who cannot fix it
		// without root, and the file is still the only place the key lives.
		if (mode !== undefined && (mode & 0o077) !== 0) {
			warn(
				`${path} is readable by other users (mode ${mode.toString(8).padStart(3, '0')}). ` +
					`Run: chmod 600 ${path}`
			);
		}
		file = parseConfigFile(d.readFile(path), path, warn);
	}

	const pick = (envName: string, key: keyof Config): unknown => {
		// A command-line override beats everything, then the environment, then the
		// file, then the default. The order matters most for `baseUrl`, which is
		// the setting most often overridden for a single run.
		if (key === 'dmmBaseUrl' && overrides.baseUrl) return overrides.baseUrl;
		if (key === 'torboxApiKey' && overrides.apiKey) return overrides.apiKey;
		const fromEnv = d.env[envName];
		if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv;
		return file[key];
	};

	const baseUrlRaw = str(pick('DMM_BASE_URL', 'dmmBaseUrl'));
	const apiKeyRaw = str(pick('TORBOX_API_KEY', 'torboxApiKey'));
	const filterRaw = str(pick('DMM_TUI_FILTER', 'defaultFilter'));
	const apiBaseRaw = str(pick('DMM_TUI_TORBOX_API', 'torboxApiBase'));

	if (!baseUrlRaw) {
		throw new ConfigError(
			`No DMM base URL. Set DMM_BASE_URL, or "dmmBaseUrl" in ${path}, or pass --base-url.`
		);
	}
	// `--dump` opts out. Its Torbox stage is skipped whenever the release list is
	// empty, so requiring the key here meant the command meant to answer "is this
	// instance answering at all?" could not be run before the account was set up —
	// which is the order in which you find out you need it.
	if (!apiKeyRaw && overrides.requireTorboxKey !== false) {
		throw new ConfigError(
			`No Torbox API key. Set TORBOX_API_KEY, or "torboxApiKey" in ${path}. ` +
				`The key is in your Torbox account settings; it is not the same as your login password.`
		);
	}

	return {
		dmmBaseUrl: normaliseBaseUrl(baseUrlRaw, 'DMM base URL'),
		// Empty only under `--dump`, which opted out of requiring one.
		torboxApiKey: apiKeyRaw ?? '',
		defaultFilter: filterRaw ?? DEFAULTS.defaultFilter,
		showUncached: envFlag(
			pick('DMM_TUI_SHOW_UNCACHED', 'showUncached') as string | undefined,
			DEFAULTS.showUncached,
			'DMM_TUI_SHOW_UNCACHED',
			warn
		),
		showArchiveOnly: envFlag(
			pick('DMM_TUI_SHOW_ARCHIVE', 'showArchiveOnly') as string | undefined,
			DEFAULTS.showArchiveOnly,
			'DMM_TUI_SHOW_ARCHIVE',
			warn
		),
		verifyAdds: envFlag(
			pick('DMM_TUI_VERIFY', 'verifyAdds') as string | undefined,
			DEFAULTS.verifyAdds,
			'DMM_TUI_VERIFY',
			warn
		),
		torboxApiBase: normaliseBaseUrl(apiBaseRaw ?? DEFAULTS.torboxApiBase, 'Torbox API base'),
	};
}

/**
 * A stable, non-reversible stand-in for the key, so `--check-config` can prove
 * *which* key is loaded without printing it. Hashing rather than showing a
 * prefix because a prefix is a prefix, and this output lands in terminals,
 * scrollback and pasted logs.
 */
export function fingerprintKey(apiKey: string): string {
	return `sha256:${createHash('sha256').update(apiKey).digest('hex').slice(0, 12)}`;
}
