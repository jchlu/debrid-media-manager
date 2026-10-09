import { checkTorBoxKey, planName } from '@/tui/torbox/key';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const FIXTURES = path.join(process.cwd(), 'src', 'test', 'fixtures', 'torbox');

/** A recorded TorBox response: `{ status, body }`, exactly as it was observed. */
function recorded(name: string): { status: number; body: unknown } {
	return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'));
}

function stubFetch(body: unknown, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	});
}

const BASE = 'https://api.torbox.app';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('checkTorBoxKey', () => {
	it('accepts a working key on a paid plan', async () => {
		const fixture = recorded('user-me-standard-plan-2026-09-24.json');
		const fetchMock = stubFetch(fixture.body, fixture.status);
		vi.stubGlobal('fetch', fetchMock);

		const result = await checkTorBoxKey('good-key', BASE);

		expect(result).toEqual({ ok: true, userId: 1, plan: 2, planName: 'Standard' });
	});

	it('sends the key as a bearer header to /user/me', async () => {
		const fixture = recorded('user-me-standard-plan-2026-09-24.json');
		const fetchMock = stubFetch(fixture.body, fixture.status);
		vi.stubGlobal('fetch', fetchMock);

		await checkTorBoxKey('good-key', BASE);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.torbox.app/v1/api/user/me');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer good-key');
	});

	it('never puts the key in the URL', async () => {
		// torboxCastApiHelpers.ts:19-27 records why: the query-string form wrote
		// thousands of keys into nginx access logs.
		const fixture = recorded('user-me-standard-plan-2026-09-24.json');
		const fetchMock = stubFetch(fixture.body, fixture.status);
		vi.stubGlobal('fetch', fetchMock);

		await checkTorBoxKey('good-key', BASE);

		expect(String(fetchMock.mock.calls[0][0])).not.toContain('good-key');
	});

	it('reports a bad token as invalid, and quotes TorBox detail', async () => {
		const fixture = recorded('user-me-bad-token-2026-09-24.json');
		vi.stubGlobal('fetch', stubFetch(fixture.body, fixture.status));

		const result = await checkTorBoxKey('stale-key', BASE);

		expect(result).toMatchObject({ ok: false, reason: 'invalid' });
		expect(result.ok === false && result.message).toMatch(/invalid or has expired/);
	});

	it('detects a free plan from the refusal code', async () => {
		const fixture = recorded('createtorrent-plan-restricted-2026-09-23.json');
		vi.stubGlobal('fetch', stubFetch(fixture.body, fixture.status));

		const result = await checkTorBoxKey('free-key', BASE);

		expect(result).toMatchObject({ ok: false, reason: 'free-plan' });
		expect(result.ok === false && result.message).toMatch(/paid TorBox plan/);
	});

	it('detects a free plan from plan: 0 even when TorBox says yes', async () => {
		// The 403 only appears once the client tries to add something. A profile
		// that simply reports plan 0 is the earlier, kinder signal.
		vi.stubGlobal(
			'fetch',
			stubFetch({ success: true, error: null, detail: '', data: { id: 7, plan: 0 } })
		);

		const result = await checkTorBoxKey('free-key', BASE);

		expect(result).toMatchObject({ ok: false, reason: 'free-plan' });
	});

	it('does not mistake a 429 for a broken key', async () => {
		vi.stubGlobal('fetch', stubFetch({ success: false, error: 'RATE_LIMIT' }, 429));

		const result = await checkTorBoxKey('good-key', BASE);

		expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
		expect(result.ok === false && result.message).toMatch(/not a verdict on the key/);
	});

	it('does not mistake a network failure for a broken key', async () => {
		// The failure mode this distinction exists for: telling someone to reset a
		// key that was fine because the Wi-Fi blipped.
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));

		const result = await checkTorBoxKey('good-key', BASE);

		expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
		expect(result.ok === false && result.message).toMatch(/ENOTFOUND/);
	});

	it('does not treat a 200 carrying success:false as a working key', async () => {
		// src/hooks/auth.ts:387 records this: TorBox has answered a rejected key
		// with a 200 in the past, so the status code is never the test.
		vi.stubGlobal(
			'fetch',
			stubFetch({ success: false, error: 'BAD_TOKEN', detail: 'nope', data: null })
		);

		const result = await checkTorBoxKey('stale-key', BASE);

		expect(result.ok).toBe(false);
	});

	it('reports a profile with no plan as undecided rather than free', async () => {
		vi.stubGlobal(
			'fetch',
			stubFetch({ success: true, error: null, detail: '', data: { id: 7 } })
		);

		const result = await checkTorBoxKey('good-key', BASE);

		expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
	});

	it('tolerates a trailing slash on the API base', async () => {
		const fixture = recorded('user-me-standard-plan-2026-09-24.json');
		const fetchMock = stubFetch(fixture.body, fixture.status);
		vi.stubGlobal('fetch', fetchMock);

		await checkTorBoxKey('good-key', `${BASE}/`);

		expect(fetchMock.mock.calls[0][0]).toBe('https://api.torbox.app/v1/api/user/me');
	});
});

describe('planName', () => {
	it.each([
		[0, 'Free'],
		[1, 'Essential'],
		[2, 'Standard'],
		[3, 'Pro'],
	])('names plan %i as %s', (plan, expected) => {
		expect(planName(plan)).toBe(expected);
	});

	it('names an unrecognised plan rather than guessing', () => {
		expect(planName(9)).toBe('plan 9');
	});
});
