import { ArgError, parseArgs, USAGE } from '@/tui/args';
import { describe, expect, it } from 'vitest';

describe('parseArgs', () => {
	it('defaults to the interactive screen', () => {
		expect(parseArgs([])).toEqual({ kind: 'interactive' });
	});

	it('recognises help under both spellings', () => {
		expect(parseArgs(['-h']).kind).toBe('help');
		expect(parseArgs(['--help']).kind).toBe('help');
	});

	it('recognises --check-config', () => {
		expect(parseArgs(['--check-config'])).toEqual({ kind: 'check-config' });
	});

	it('reads a base url as either a following value or an inline one', () => {
		expect(parseArgs(['--base-url', 'http://x:3000'])).toEqual({
			kind: 'interactive',
			baseUrl: 'http://x:3000',
		});
		expect(parseArgs(['--base-url=http://x:3000'])).toEqual({
			kind: 'interactive',
			baseUrl: 'http://x:3000',
		});
	});

	it('keeps a query string attached to an inline base url', () => {
		// A URL pasted from a shell often arrives whole; splitting on the first
		// `=` rather than the last is what makes that survive.
		expect(parseArgs(['--base-url=http://x:3000/api?a=b'])).toEqual({
			kind: 'interactive',
			baseUrl: 'http://x:3000/api?a=b',
		});
	});

	it('reads a jump-in query', () => {
		expect(parseArgs(['--query', 'dune'])).toEqual({ kind: 'interactive', query: 'dune' });
	});

	it('reads --dump as its own mode', () => {
		expect(parseArgs(['--dump', 'dune'])).toEqual({ kind: 'dump', query: 'dune' });
		expect(parseArgs(['--dump=dune'])).toEqual({ kind: 'dump', query: 'dune' });
	});

	it('carries --season through to --dump', () => {
		expect(parseArgs(['--dump', 'breaking bad', '--season', '2'])).toEqual({
			kind: 'dump',
			query: 'breaking bad',
			season: 2,
		});
		expect(parseArgs(['--dump=x', '--season=0'])).toEqual({
			kind: 'dump',
			query: 'x',
			season: 0,
		});
	});

	it.each([['two'], ['1.5'], ['-1']])(
		'rejects a season that is not a whole number (%s)',
		(raw) => {
			expect(() => parseArgs(['--dump', 'x', '--season', raw])).toThrow(ArgError);
		}
	);

	it('rejects --season with no value', () => {
		expect(() => parseArgs(['--season'])).toThrow('--season needs a value.');
	});

	it('lets help win over every other mode', () => {
		expect(parseArgs(['--dump', 'dune', '--help']).kind).toBe('help');
		expect(parseArgs(['--check-config', '-h']).kind).toBe('help');
	});

	it('keeps the first mode when two are given', () => {
		expect(parseArgs(['--check-config', '--dump', 'dune'])).toEqual({ kind: 'check-config' });
	});

	it.each([['--base-url'], ['--query'], ['--dump']])('rejects %s with no value', (flag) => {
		expect(() => parseArgs([flag])).toThrow(ArgError);
		expect(() => parseArgs([flag])).toThrow(`${flag} needs a value.`);
	});

	it('rejects an unknown option and points at --help', () => {
		expect(() => parseArgs(['--nope'])).toThrow('Unknown option "--nope"');
		expect(() => parseArgs(['--nope'])).toThrow(/--help/);
	});

	it('rejects a positional argument rather than ignoring it', () => {
		expect(() => parseArgs(['dune'])).toThrow(ArgError);
	});
});

describe('USAGE', () => {
	it('documents every mode parseArgs can return', () => {
		for (const flag of [
			'--check-config',
			'--base-url',
			'--query',
			'--dump',
			'--season',
			'--help',
		]) {
			expect(USAGE).toContain(flag);
		}
	});
});
