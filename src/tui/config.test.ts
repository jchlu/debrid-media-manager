import {
	ConfigError,
	fingerprintKey,
	loadConfig,
	resolveConfigPath,
	type LoadConfigDeps,
} from '@/tui/config';
import { describe, expect, it } from 'vitest';

/**
 * Every test injects the filesystem. The real one is never touched, so these
 * run identically on a developer machine and on a box with no `~/.config`.
 */
function deps(over: Partial<LoadConfigDeps> = {}): LoadConfigDeps {
	const warnings: string[] = [];
	return {
		env: {},
		configPath: '/tmp/dmm-tui-test/config.json',
		exists: () => false,
		readFile: () => '',
		mode: () => 0o600,
		homedir: () => '/home/tester',
		warn: (m) => warnings.push(m),
		...over,
	} as LoadConfigDeps & { warnings: string[] };
}

const withFile = (contents: unknown, over: Partial<LoadConfigDeps> = {}) => {
	const text = typeof contents === 'string' ? contents : JSON.stringify(contents);
	return deps({ exists: () => true, readFile: () => text, ...over });
};

const MINIMAL_ENV = { DMM_BASE_URL: 'http://dmm:3000', TORBOX_API_KEY: 'key-abc' };

describe('resolveConfigPath', () => {
	it('prefers XDG_CONFIG_HOME', () => {
		expect(
			resolveConfigPath({ env: { XDG_CONFIG_HOME: '/x/cfg' }, homedir: () => '/home/t' })
		).toBe('/x/cfg/dmm-tui/config.json');
	});

	it('falls back to ~/.config when XDG is unset or blank', () => {
		expect(resolveConfigPath({ env: {}, homedir: () => '/home/t' })).toBe(
			'/home/t/.config/dmm-tui/config.json'
		);
		expect(
			resolveConfigPath({ env: { XDG_CONFIG_HOME: '  ' }, homedir: () => '/home/t' })
		).toBe('/home/t/.config/dmm-tui/config.json');
	});
});

describe('loadConfig', () => {
	it('reads both required settings from the environment', () => {
		const config = loadConfig({}, deps({ env: MINIMAL_ENV }));
		expect(config.dmmBaseUrl).toBe('http://dmm:3000');
		expect(config.torboxApiKey).toBe('key-abc');
	});

	it('reads them from the config file when the environment is empty', () => {
		const config = loadConfig(
			{},
			withFile({ dmmBaseUrl: 'http://file:3000', torboxApiKey: 'file-key' })
		);
		expect(config.dmmBaseUrl).toBe('http://file:3000');
		expect(config.torboxApiKey).toBe('file-key');
	});

	it('lets the environment beat the file', () => {
		const config = loadConfig(
			{},
			withFile({ dmmBaseUrl: 'http://file:3000' }, { env: MINIMAL_ENV })
		);
		expect(config.dmmBaseUrl).toBe('http://dmm:3000');
	});

	it('lets a command-line override beat everything', () => {
		const config = loadConfig(
			{ baseUrl: 'http://cli:3000', apiKey: 'cli-key' },
			withFile(
				{ dmmBaseUrl: 'http://file:3000', torboxApiKey: 'file-key' },
				{ env: MINIMAL_ENV }
			)
		);
		expect(config.dmmBaseUrl).toBe('http://cli:3000');
		expect(config.torboxApiKey).toBe('cli-key');
	});

	it('applies every documented default', () => {
		const config = loadConfig({}, deps({ env: MINIMAL_ENV }));
		expect(config.defaultFilter).toBe('is:tb');
		expect(config.showUncached).toBe(false);
		expect(config.showArchiveOnly).toBe(false);
		expect(config.verifyAdds).toBe(true);
		expect(config.torboxApiBase).toBe('https://api.torbox.app');
	});

	it('keeps both safety toggles off by default', () => {
		// The single most important default in the client: with no
		// configuration at all, nothing unreachable can spend Torbox points or
		// hand back an archive instead of a playable file.
		const config = loadConfig({}, deps({ env: MINIMAL_ENV }));
		expect(config.showUncached || config.showArchiveOnly).toBe(false);
	});

	describe('required settings', () => {
		it('names the missing base URL and every way to supply it', () => {
			expect(() => loadConfig({}, deps({ env: { TORBOX_API_KEY: 'k' } }))).toThrow(
				ConfigError
			);
			expect(() => loadConfig({}, deps({ env: { TORBOX_API_KEY: 'k' } }))).toThrow(
				/DMM_BASE_URL.*--base-url/s
			);
		});

		it('names the missing key', () => {
			expect(() =>
				loadConfig({}, deps({ env: { DMM_BASE_URL: 'http://dmm:3000' } }))
			).toThrow(/TORBOX_API_KEY/);
		});

		it('rejects a base URL with no scheme', () => {
			expect(() =>
				loadConfig({}, deps({ env: { ...MINIMAL_ENV, DMM_BASE_URL: 'dmm:3000' } }))
			).toThrow(/http:\/\/ or https:\/\//);
		});

		it('strips trailing slashes so paths join cleanly', () => {
			const config = loadConfig(
				{},
				deps({ env: { ...MINIMAL_ENV, DMM_BASE_URL: 'http://dmm:3000//' } })
			);
			expect(config.dmmBaseUrl).toBe('http://dmm:3000');
		});

		// `--dump` is how you find out whether an instance is answering at all,
		// which is the question you have before you have an account to point at.
		it('lets --dump run with no key, and still demands a base URL', () => {
			const config = loadConfig(
				{ requireTorboxKey: false },
				deps({ env: { DMM_BASE_URL: 'http://dmm:3000' } })
			);
			expect(config.torboxApiKey).toBe('');
			expect(config.dmmBaseUrl).toBe('http://dmm:3000');
			// Opting out of the key does not opt out of everything else.
			expect(() =>
				loadConfig({ requireTorboxKey: false }, deps({ env: { TORBOX_API_KEY: 'k' } }))
			).toThrow(/DMM_BASE_URL/);
		});
	});

	describe('booleans', () => {
		it.each([
			['1', true],
			['true', true],
			['YES', true],
			['on', true],
			['0', false],
			['false', false],
			['no', false],
			['OFF', false],
		])('reads %s as %s', (raw, expected) => {
			const config = loadConfig(
				{},
				deps({ env: { ...MINIMAL_ENV, DMM_TUI_SHOW_UNCACHED: raw } })
			);
			expect(config.showUncached).toBe(expected);
		});

		it('warns and falls back rather than reading a typo as false', () => {
			const warnings: string[] = [];
			const config = loadConfig(
				{},
				deps({
					env: { ...MINIMAL_ENV, DMM_TUI_SHOW_UNCACHED: 'treu' },
					warn: (m) => warnings.push(m),
				})
			);
			expect(config.showUncached).toBe(false);
			expect(warnings.join()).toMatch(/DMM_TUI_SHOW_UNCACHED.*treu/);
		});
	});

	describe('config file', () => {
		it('warns when readable by other users, and still loads', () => {
			const warnings: string[] = [];
			const config = loadConfig(
				{},
				withFile(
					{ dmmBaseUrl: 'http://f:3000', torboxApiKey: 'k' },
					{ mode: () => 0o644, warn: (m) => warnings.push(m) }
				)
			);
			expect(config.torboxApiKey).toBe('k');
			expect(warnings.join()).toMatch(/chmod 600/);
		});

		it('stays quiet at 0600', () => {
			const warnings: string[] = [];
			loadConfig(
				{},
				withFile(
					{ dmmBaseUrl: 'http://f:3000', torboxApiKey: 'k' },
					{ mode: () => 0o600, warn: (m) => warnings.push(m) }
				)
			);
			expect(warnings).toEqual([]);
		});

		it('names the file when it is not valid JSON', () => {
			expect(() => loadConfig({}, withFile('{ nope'))).toThrow(
				/\/tmp\/dmm-tui-test\/config\.json.*not valid JSON/s
			);
		});

		it('rejects a JSON array or scalar', () => {
			expect(() => loadConfig({}, withFile('[1,2]'))).toThrow(/must contain a JSON object/);
			expect(() => loadConfig({}, withFile('"hello"'))).toThrow(/must contain a JSON object/);
		});

		it('warns about an unknown key but keeps going', () => {
			const warnings: string[] = [];
			const config = loadConfig(
				{},
				withFile(
					{ dmmBaseUrl: 'http://f:3000', torboxApiKey: 'k', showUncachd: true },
					{ warn: (m) => warnings.push(m) }
				)
			);
			expect(config.dmmBaseUrl).toBe('http://f:3000');
			expect(warnings.join()).toMatch(/unknown setting "showUncachd"/);
		});

		it('is not required when the environment already supplies everything', () => {
			const config = loadConfig({}, deps({ env: MINIMAL_ENV, exists: () => false }));
			expect(config.dmmBaseUrl).toBe('http://dmm:3000');
		});
	});
});

describe('fingerprintKey', () => {
	it('is stable for the same key', () => {
		expect(fingerprintKey('abc')).toBe(fingerprintKey('abc'));
	});

	it('differs for a different key', () => {
		expect(fingerprintKey('abc')).not.toBe(fingerprintKey('abd'));
	});

	it('reveals neither the key nor any prefix of it', () => {
		const fingerprint = fingerprintKey('super-secret-key-value');
		expect(fingerprint).toMatch(/^sha256:[0-9a-f]{12}$/);
		expect(fingerprint).not.toContain('super');
		expect(fingerprint).not.toContain('value');
	});
});
