import { DEFAULT_COOLDOWN_MS, planDrain, requestedKey } from '@/scrapers/drainPlan';
import { generateScrapeJobs } from '@/scrapers/scrapeJobs';
import { repository as db } from '@/services/repository';
import { authorizeScrapeRequest } from '@/services/scrapeAuth';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Drains one scrape request per call.
 *
 * Every title the browser opens with no releases writes a `requested:tt…` row.
 * Until now nothing read those rows on a self-hosted instance: production runs
 * `scraper.sh` on another host to do it, and that host is not here. So a request
 * was recorded, the grid said "a scrape was queued", and the queue sat unread
 * forever.
 *
 * One per call, not a loop. The scrapers are slow and rate-limited, so draining
 * the whole queue inside one request would time out and hammer the sites it is
 * asking. Call it from cron every minute and it converges at whatever pace the
 * scrapers allow:
 *
 *     * * * * * curl -fsS -H "x-scrape-password: $SCRAPE_API_PASSWORD" \
 *         http://localhost:3000/api/scrapers/drain >/dev/null
 *
 * Password-gated by the same guard as its siblings, and it fails closed.
 */

export type DrainResponse = {
	status: 'idle' | 'cooldown' | 'drained' | 'failed';
	imdbId?: string;
	retryInSeconds?: number;
	errorMessage?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<DrainResponse>) {
	if (!authorizeScrapeRequest(req, res)) {
		return;
	}

	let oldest;
	try {
		oldest = await db.getOldestRequest();
	} catch (error) {
		res.status(500).json({
			status: 'failed',
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
		return;
	}

	const plan = planDrain(
		oldest ? { imdbId: oldest.key, updatedAt: oldest.updatedAt } : null,
		Date.now(),
		Number(req.query.cooldownMs) || DEFAULT_COOLDOWN_MS
	);

	if (plan.action === 'idle') {
		res.status(200).json({ status: 'idle' });
		return;
	}
	if (plan.action === 'cooldown') {
		res.status(200).json({
			status: 'cooldown',
			imdbId: plan.imdbId,
			retryInSeconds: Math.ceil(plan.retryInMs / 1000),
		});
		return;
	}

	try {
		// Season 0 means "the movie, or every season of a show" — the same default
		// the browser uses when it opens a title.
		await generateScrapeJobs(plan.imdbId, 0);
	} catch (error) {
		// Bump the request to the back of the queue. Without this the oldest row is
		// returned again on the next pass and nothing behind it is ever attempted.
		await db.saveScrapedResults(requestedKey(plan.imdbId), [], true).catch(() => undefined);
		res.status(200).json({
			status: 'failed',
			imdbId: plan.imdbId,
			errorMessage: error instanceof Error ? error.message : 'Unknown error',
		});
		return;
	}

	res.status(200).json({ status: 'drained', imdbId: plan.imdbId });
}
