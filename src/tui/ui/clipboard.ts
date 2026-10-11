/**
 * Getting a hash out of a TUI and into somewhere pasteable.
 *
 * There is no system clipboard to write to over SSH. The mechanism is OSC 52, an
 * escape sequence asking the *terminal emulator* to set its own clipboard, and it
 * is the only one that works without a display, a browser or an X11 connection.
 *
 * It is also silently refused often enough that it cannot be the whole answer:
 * tmux needs `set-clipboard on`, many emulators rate-limit or disable it, and
 * nothing reports back. So this never claims success. It emits the sequence and
 * says it was sent, and the caller also shows the hash on screen — which works
 * when the escape sequence is refused, and costs one line.
 */

/** The clipboard target OSC 52 addresses. `c` is the system clipboard. */
const PRIMARY = 'c';

const BEL = '\x07';

/**
 * The escape sequence that asks the terminal to set its clipboard.
 *
 * Base64 because the payload is raw hash text and OSC 52 takes no escaping of its
 * own; an unencoded payload would terminate early on a `;` or a control byte.
 */
export function osc52Sequence(text: string, target: string = PRIMARY): string {
	return `\x1b]52;${target};${Buffer.from(text, 'utf8').toString('base64')}${BEL}`;
}

/**
 * Emits the sequence on a stream Ink does not own.
 *
 * Written outside React's render on purpose: Ink repaints the alt screen from its
 * own diff, and a sequence written during a render can be swallowed by the frame
 * that follows it.
 */
export function sendToClipboard(
	text: string,
	write: (chunk: string) => void = (chunk) => process.stdout.write(chunk)
): void {
	write(osc52Sequence(text));
}

/**
 * What to tell the user, given that we cannot confirm the write.
 *
 * `confirmed: false` is not a formality. A "copied" message on a hash that never
 * reached the clipboard costs a failed paste and the suspicion that the grid is
 * handing out the wrong hash.
 */
export function describeCopy(hash: string, confirmed: boolean): string {
	if (confirmed) return `Copied ${hash}.`;
	return (
		`Sent ${hash} to the terminal clipboard (osc52). If your terminal or tmux blocks it, ` +
		`the hash is printed here: ${hash}`
	);
}
