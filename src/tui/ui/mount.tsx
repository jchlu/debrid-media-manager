import type { Config } from '@/tui/config';
import App from '@/tui/ui/App';
import { takeTerminal } from '@/tui/ui/terminal';
import { render } from 'ink';

/**
 * Mounting the UI.
 *
 * Ink's own Ctrl-C handling is switched off so that quit goes through one path,
 * which is the same path that restores the terminal. `exitOnCtrlC: false` plus an
 * explicit handler is the only arrangement where a Ctrl-C cannot leave an SSH
 * session with a dead pane.
 */
export function mountUi(config: Config, initialQuery?: string): void {
	const terminal = takeTerminal();
	let quit = false;

	const instance = render(
		<App
			config={config}
			initialQuery={initialQuery}
			onQuit={() => {
				quit = true;
			}}
		/>,
		{ exitOnCtrlC: false }
	);

	instance.waitUntilExit().then(() => {
		terminal.restore();
		process.exitCode = quit ? 0 : 0;
	});
}
