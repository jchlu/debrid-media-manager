/**
 * A real process that takes the terminal, so a signal can be delivered to it.
 *
 * `takeTerminal`'s restore paths are unit-tested with injected writers and fake
 * signal hooks, which proves the sequences are written when a handler *runs*.
 * It cannot prove a handler was ever registered — and that is the failure that
 * matters, because over SSH an unhandled signal leaves the pane on the alternate
 * screen with no prompt and no way back.
 *
 * That is not hypothetical: the default branches of `takeTerminal` built their
 * `process` listeners without ever calling them, so nothing was registered at
 * all, and every injected-hook test still passed. So this runs for real,
 * announces itself on stderr once the terminal is taken, and idles until killed.
 */
import { takeTerminal } from '@/tui/ui/terminal';

takeTerminal();

// stderr, because stdout carries the terminal's escape sequences and the test
// reads them as a stream of bytes.
process.stderr.write('READY\n');

// Keeps the event loop alive so the process is killed rather than exiting first.
setInterval(() => {}, 1 << 30);
