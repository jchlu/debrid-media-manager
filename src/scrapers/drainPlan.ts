/**
 * What one drain pass should do with the oldest queued scrape request.
 *
 * The queue is a set of `requested:tt…` rows in the database, written by whoever
 * opened a title that had no releases. Nothing read them: production drains this
 * queue from `scraper.sh` on another host, so a self-hosted instance accumulated
 * requests that no one would ever answer. This is that reader.
 *
 * Two rules it has to get right, both about a queue that never empties:
 *
 * - **Don't retry on the next tick.** A scrape that just failed will fail again
 *   immediately, and a cron entry every minute would spend the scraper's full
 *   budget on one title. So a request younger than a cooldown is left alone.
 * - **Don't starve the queue.** `getOldestRequest` returns the *oldest* row, so
 *   a title that can never be scraped — no metadata provider, a malformed id —
 *   would be handed back on every pass and every other request would wait
 *   forever behind it. A failure is therefore bumped to the back of the queue by
 *   touching its timestamp, rather than left where it is.
 *
 * Pure, so both rules are testable without a database.
 */

/** How long a request is left alone after it was last attempted. */
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export type QueuedRequest = {
	/** An IMDb id, as stored: `requested:tt123` is queued as `tt123`. */
	imdbId: string;
	updatedAt: Date;
};

export type DrainPlan =
	/** The queue is empty. */
	| { action: 'idle' }
	/** Attempted too recently to be worth another try. */
	| { action: 'cooldown'; imdbId: string; retryInMs: number }
	/** Run the scrapers for this title. */
	| { action: 'scrape'; imdbId: string };

export function planDrain(
	oldest: QueuedRequest | null,
	now: number = Date.now(),
	cooldownMs: number = DEFAULT_COOLDOWN_MS
): DrainPlan {
	if (!oldest) return { action: 'idle' };
	const age = now - oldest.updatedAt.getTime();
	if (age < cooldownMs) {
		return { action: 'cooldown', imdbId: oldest.imdbId, retryInMs: cooldownMs - age };
	}
	return { action: 'scrape', imdbId: oldest.imdbId };
}

/**
 * Pushes a failed request to the back of the queue.
 *
 * `saveScrapedResults('requested:<id>', [], true)` writes the same key with an
 * empty array and bumps `updatedAt`, which is all `getOldestRequest` orders by.
 * Cheaper than a new repository method and already the shape every caller uses.
 */
export function requestedKey(imdbId: string): string {
	return `requested:${imdbId}`;
}

/** True while the request is still queued, i.e. the scrape never cleared it. */
export async function stillQueued(
	imdbId: string,
	keyExists: (key: string) => Promise<boolean>
): Promise<boolean> {
	return keyExists(requestedKey(imdbId));
}
