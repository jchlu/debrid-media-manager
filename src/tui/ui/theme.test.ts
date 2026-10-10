import { colourEnabled, palette } from '@/tui/ui/theme';
import { describe, expect, it } from 'vitest';

describe('colourEnabled', () => {
	const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

	it('honours NO_COLOR, which outranks everything', () => {
		expect(
			colourEnabled(env({ NO_COLOR: '1', FORCE_COLOR: '3', TERM: 'xterm-256color' }))
		).toBe(false);
	});

	it('treats an empty NO_COLOR as unset', () => {
		// The convention is that any value at all disables colour, but an empty
		// string is how an unset variable is often spelled in a .env file.
		expect(colourEnabled(env({ NO_COLOR: '', FORCE_COLOR: '3' }))).toBe(true);
	});

	it('honours FORCE_COLOR, which is how a pipe gets colour', () => {
		expect(colourEnabled(env({ FORCE_COLOR: '3' }))).toBe(true);
		expect(colourEnabled(env({ FORCE_COLOR: '1' }))).toBe(true);
	});

	it.each([['0'], ['false'], ['']])('does not honour FORCE_COLOR=%j', (value) => {
		// Falls through to the TTY check, which is false under a test runner.
		expect(colourEnabled(env({ FORCE_COLOR: value, TERM: 'xterm' }))).toBe(false);
	});

	it('never emits colour on a dumb terminal', () => {
		expect(colourEnabled(env({ TERM: 'dumb' }))).toBe(false);
	});
});

describe('palette', () => {
	it('falls back to the 16 ANSI names when colour is off', () => {
		// Named colours survive every theme and every terminal; a hex value
		// silently renders as nothing on a 16-colour one.
		const off = palette(false);
		expect(Object.values(off).every((c) => !c.startsWith('#'))).toBe(true);
	});

	it('uses hex when colour is on', () => {
		expect(Object.values(palette(true)).every((c) => c.startsWith('#'))).toBe(true);
	});

	it('gives every state a distinct colour, so a legend is possible', () => {
		const p = palette(true);
		expect(new Set([p.cached, p.archive, p.uncached]).size).toBe(3);
	});
});
