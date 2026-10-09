#!/usr/bin/env node
/**
 * dmm-tui — search a title and add a release to your Torbox account.
 *
 * Implemented against docs/SPEC-tui.md. The entry point stays thin: parse, load,
 * dispatch. Everything it calls is a module that can be tested without a
 * process, because the only thing worth testing here is that it prints the right
 * message and exits with the right code.
 */

import { ArgError, parseArgs, USAGE } from '@/tui/args';
import { ConfigError, fingerprintKey, loadConfig } from '@/tui/config';
import { checkTorBoxKey } from '@/tui/torbox/key';

/** Config or usage problems exit 2, matching the convention that 0 is success
 *  and 1 is "something ran and failed". A missing key is not a crash. */
const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

const out = (line = '') => process.stdout.write(`${line}\n`);

async function checkConfig(args: { baseUrl?: string }) {
	const config = loadConfig({ baseUrl: args.baseUrl });
	out('dmm-tui configuration');
	out(`  DMM base URL   ${config.dmmBaseUrl}`);
	out(`  Torbox API     ${config.torboxApiBase}`);
	// Hashed rather than prefixed: this output lands in scrollback and in pasted
	// logs, and a prefix of a key is still a prefix of a key.
	out(`  Torbox key     ${fingerprintKey(config.torboxApiKey)}`);
	out(`  Default filter ${config.defaultFilter}`);
	out(`  Uncached rows  ${config.showUncached ? 'shown' : 'hidden (default)'}`);
	out(`  Archive rows   ${config.showArchiveOnly ? 'shown' : 'hidden (default)'}`);
	out(`  Verify adds    ${config.verifyAdds ? 'yes' : 'no'}`);
	out();

	out('Checking the Torbox key…');
	const check = await checkTorBoxKey(config.torboxApiKey, config.torboxApiBase);
	if (check.ok) {
		out(`  OK — TorBox user ${check.userId} on the ${check.planName} plan.`);
		return 0;
	}
	// Both reasons exit 1: something failed. They are told apart in the message
	// rather than the code, because the difference that matters to the user is
	// "fix your key" versus "try again" — and `--check-config` exists to be read.
	out(`  FAILED (${check.reason}) — ${check.message}`);
	return EXIT_FAILED;
}

async function main(): Promise<number> {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		if (error instanceof ArgError) {
			process.stderr.write(`${error.message}\n\n${USAGE}\n`);
			return EXIT_USAGE;
		}
		throw error;
	}

	if (args.kind === 'help') {
		out(USAGE);
		return 0;
	}

	try {
		if (args.kind === 'check-config') {
			return await checkConfig({ baseUrl: undefined });
		}
		if (args.kind === 'dump') {
			const config = loadConfig({ baseUrl: undefined });
			const { dump } = await import('@/tui/dump');
			return await dump(config, args.query, args.season);
		}
		// Slice 4. The UI lands after the read path and the provider logic, so
		// that there is no way to spend Torbox points while the grid is being
		// debugged over SSH.
		process.stderr.write('The interactive UI is not implemented yet.\n');
		return EXIT_FAILED;
	} catch (error) {
		if (error instanceof ConfigError) {
			process.stderr.write(`${error.message}\n`);
			return EXIT_USAGE;
		}
		throw error;
	}
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error: unknown) => {
		process.stderr.write(`dmm-tui: ${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = EXIT_FAILED;
	});
