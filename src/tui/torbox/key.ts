import type { TorBoxResponse, TorBoxUser } from '@/services/types';

/**
 * Whether this key can actually add anything, asked once at startup.
 *
 * A free TorBox account has no API access. Its `checkcached` answers normally,
 * so nothing is wrong right up until `createtorrent` refuses with
 * `403 PLAN_RESTRICTED_FEATURE` — nineteen transfers died that way between
 * 2026-08-08 and 2026-09-23 before DMM started asking first
 * (`src/utils/torboxPlan.ts:1-6`). Here the check is the whole client rather than
 * one step of a pipeline, so it is worth doing properly and reporting the reason.
 */

const TIMEOUT_MS = 5000;

/** TorBox's `plan` field: 0 Free, 1 Essential, 2 Standard, 3 Pro. */
const PLAN_NAMES: Record<number, string> = {
	0: 'Free',
	1: 'Essential',
	2: 'Standard',
	3: 'Pro',
};

const FREE_PLAN = 0;

export type KeyCheck =
	| { ok: true; userId: number; plan: number; planName: string }
	/** TorBox answered, and the answer was no. */
	| { ok: false; reason: 'invalid' | 'free-plan'; message: string }
	/**
	 * Torbox gave no answer — a timeout, a 429, a DNS failure, a body that does
	 * not parse.
	 *
	 * Kept distinct from `invalid` on purpose. `src/utils/torboxPlan.ts:19-25`
	 * returns "not free" for anything uncertain, because there a wrong answer
	 * would only let a doomed job through to the uploader, which reports it
	 * properly. Here the wrong answer is a message telling the user their key is
	 * broken when the network blipped, and that sends them off to reset a key
	 * that was fine.
	 */
	| { ok: false; reason: 'unreachable'; message: string };

export const planName = (plan: number): string => PLAN_NAMES[plan] ?? `plan ${plan}`;

export async function checkTorBoxKey(apiKey: string, apiBase: string): Promise<KeyCheck> {
	let res: Response;
	try {
		res = await fetch(`${apiBase.replace(/\/+$/, '')}/v1/api/user/me`, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (error) {
		return {
			ok: false,
			reason: 'unreachable',
			message: `Could not reach TorBox at ${apiBase}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}

	const body = (await res.json().catch(() => null)) as TorBoxResponse<TorBoxUser> | null;
	const errorCode = typeof body?.error === 'string' ? body.error : undefined;

	// Both refusals arrive as 403 and are told apart by the error code. A bad
	// token is a 403 BAD_TOKEN, not a 401 — see
	// src/test/fixtures/torbox/user-me-bad-token-2026-09-24.json — and some
	// refusals arrive as a 200 carrying `success: false`, which is why the
	// status code alone is never the test.
	if (res.status === 403 && errorCode === 'PLAN_RESTRICTED_FEATURE') {
		return {
			ok: false,
			reason: 'free-plan',
			message:
				'Your TorBox account is on the free plan, which has no API access. ' +
				'Adding a torrent needs a paid TorBox plan.',
		};
	}
	if (errorCode === 'BAD_TOKEN') {
		return {
			ok: false,
			reason: 'invalid',
			message:
				body?.detail ||
				'TorBox rejected this API key. Copy it again from your TorBox account settings.',
		};
	}
	if (!res.ok || !body || body.success !== true) {
		return {
			ok: false,
			reason: 'unreachable',
			message:
				`TorBox answered ${res.status} without a verdict` +
				(errorCode ? ` (${errorCode})` : '') +
				'. This is not a verdict on the key — try again.',
		};
	}

	const plan = Number(body.data?.plan);
	if (!Number.isFinite(plan)) {
		return {
			ok: false,
			reason: 'unreachable',
			message: 'TorBox returned a profile with no plan field. Try again.',
		};
	}
	if (plan === FREE_PLAN) {
		return {
			ok: false,
			reason: 'free-plan',
			message:
				'Your TorBox account is on the free plan, which has no API access. ' +
				'Adding a torrent needs a paid TorBox plan.',
		};
	}

	return {
		ok: true,
		userId: Number(body.data?.id),
		plan,
		planName: planName(plan),
	};
}
