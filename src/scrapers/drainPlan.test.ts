import { DEFAULT_COOLDOWN_MS, planDrain, requestedKey, stillQueued } from '@/scrapers/drainPlan';
import { describe, expect, it } from 'vitest';

const NOW = 1_700_000_000_000;
const imdbId = 'tt0111161';

const aged = (ms: number) => ({ imdbId, updatedAt: new Date(NOW - ms) });

describe('planDrain', () => {
	it('does nothing when nothing is queued', () => {
		expect(planDrain(null, NOW)).toEqual({ action: 'idle' });
	});

	it('scrapes the oldest request once it has cooled', () => {
		expect(planDrain(aged(DEFAULT_COOLDOWN_MS), NOW)).toEqual({ action: 'scrape', imdbId });
	});

	it('leaves a just-attempted request alone, and says for how long', () => {
		// A failure retried on the next cron tick spends the scraper's whole
		// budget on one title that is not going to work this time either.
		const plan = planDrain(aged(60_000), NOW);
		expect(plan.action).toBe('cooldown');
		expect(plan).toMatchObject({ imdbId, retryInMs: DEFAULT_COOLDOWN_MS - 60_000 });
	});

	it('scrapes a request that never finished arriving with an empty title', () => {
		const plan = planDrain({ imdbId, updatedAt: new Date(0) }, NOW);
		expect(plan).toEqual({ action: 'scrape', imdbId });
	});

	it('honours a caller-supplied cooldown', () => {
		expect(planDrain(aged(10_000), NOW, 5_000)).toEqual({ action: 'scrape', imdbId });
		expect(planDrain(aged(10_000), NOW, 60_000).action).toBe('cooldown');
	});
});

describe('requestedKey', () => {
	it('is the key the grid writes and markAsDone deletes', () => {
		// Both sides have to agree on this string or a failed scrape is never
		// rotated out of the queue and the drain stalls on it forever.
		expect(requestedKey('tt0111161')).toBe('requested:tt0111161');
	});
});

describe('stillQueued', () => {
	it('is true when the scrape left the request behind', async () => {
		const seen: string[] = [];
		const left = await stillQueued(imdbId, async (k) => {
			seen.push(k);
			return true;
		});
		expect(left).toBe(true);
		expect(seen).toEqual(['requested:tt0111161']);
	});

	it('is false when the scraper cleared it, which is the success case', async () => {
		expect(await stillQueued(imdbId, async () => false)).toBe(false);
	});
});
