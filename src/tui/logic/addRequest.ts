import { mayAdd, type GuardOptions } from '@/tui/logic/normalise';
import type { GridRow } from '@/tui/logic/types';

/**
 * What pressing `a` on a row means.
 *
 * Extracted from the grid component on purpose. The safety property — no key
 * sequence can spend Torbox points or hand back an archive — is a rule about
 * rows and toggles, not about keys or pixels, and a rule that only exists inside
 * a component is a rule with no test. App renders the result; it does not decide
 * it.
 */
export type AddRequest =
	| { action: 'add' }
	| { action: 'confirm' }
	| {
			action: 'refuse';
			reason: 'in-flight' | 'already-added' | 'archive' | 'unknown' | 'hidden' | 'none';
			message: string;
	  };

export function decideAdd(
	row: GridRow | undefined,
	guards: GuardOptions,
	adding: ReadonlySet<string>
): AddRequest {
	// A selection can point past the end of a list a filter just shrank.
	if (!row) {
		return { action: 'refuse', reason: 'none', message: 'Nothing selected.' };
	}

	// Checked before anything else: a second `a` while the first is still in
	// flight would otherwise create the torrent twice.
	if (adding.has(row.hash)) {
		return {
			action: 'refuse',
			reason: 'in-flight',
			message: 'That release is already being added.',
		};
	}
	if (row.added) {
		return {
			action: 'refuse',
			reason: 'already-added',
			message: 'That release is already on the account.',
		};
	}

	if (!mayAdd(row, guards)) {
		if (row.state === 'archive') {
			return {
				action: 'refuse',
				reason: 'archive',
				message:
					'Torbox holds that release as an archive, so there is nothing playable to add.',
			};
		}
		if (row.state === 'unknown') {
			return {
				action: 'refuse',
				reason: 'unknown',
				message: 'Torbox gave no verdict on that release, so nothing is known about it.',
			};
		}
		return {
			action: 'refuse',
			reason: 'hidden',
			message: 'Press u to show uncached releases first.',
		};
	}

	// Cached is free and instant, so it adds on the key press itself. An extra
	// keystroke on every free action trains people to press through dialogs, which
	// is the opposite of what the uncached dialog is for.
	return row.state === 'instant' ? { action: 'add' } : { action: 'confirm' };
}
