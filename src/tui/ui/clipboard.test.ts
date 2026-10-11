import { describeCopy, osc52Sequence } from '@/tui/ui/clipboard';
import { describe, expect, it } from 'vitest';

describe('osc52Sequence', () => {
	it('is the escape sequence a terminal reads as a clipboard write', () => {
		const seq = osc52Sequence('abc');
		expect(seq.startsWith('\x1b]52;c;')).toBe(true);
		expect(seq.endsWith('\x07')).toBe(true);
		// base64 of "abc"
		expect(seq).toBe('\x1b]52;c;YWJj\x07');
	});

	it('encodes the payload, so separators and control bytes cannot end it early', () => {
		const seq = osc52Sequence('a;b\x07c');
		const payload = seq.slice('\x1b]52;c;'.length, -1);
		expect(Buffer.from(payload, 'base64').toString('utf8')).toBe('a;b\x07c');
		expect(payload).not.toContain(';');
		expect(payload).not.toContain('\x07');
	});

	it('handles a full 40-character hash', () => {
		const hash = 'abcdef0123456789abcdef0123456789abcdef01';
		const payload = osc52Sequence(hash).slice('\x1b]52;c;'.length, -1);
		expect(Buffer.from(payload, 'base64').toString('utf8')).toBe(hash);
	});
});

describe('describeCopy', () => {
	it('never claims a copy it could not confirm', () => {
		// tmux and many emulators refuse OSC 52 silently, and there is no reply.
		const text = describeCopy('abc123', false);
		expect(text).not.toMatch(/^Copied/);
		expect(text.toLowerCase()).toContain('sent');
		expect(text).toContain('abc123');
	});

	it('still prints the hash when the write may have been refused', () => {
		// The screen is the fallback that works when the escape sequence does not.
		expect(describeCopy('abc123', false)).toContain('abc123');
	});
});
