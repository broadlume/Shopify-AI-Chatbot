/**
 * Sync Scheduler
 * Starts a 30-minute interval on server boot.  Each tick checks every shop
 * that has an offline token and syncs if 30+ minutes have elapsed since the
 * last successful sync.  Isolated per shopDomain — no cross-store leakage.
 *
 * ⚠️  PRODUCTION DEPLOYMENT WARNING:
 * This scheduler uses setInterval inside the Node.js process. It is NOT safe
 * for multi-worker deployments (e.g. PM2 cluster mode, Kubernetes with >1 pod,
 * or any setup where multiple Node.js processes share the same database).
 *
 * In a multi-worker environment, every worker starts its own scheduler and all
 * workers will trigger simultaneous syncs for the same shops, creating DB write
 * contention and wasteful Shopify API calls.
 *
 * Recommended alternatives for multi-worker production:
 *   - Run with a single-worker process (e.g. Railway, Render, Fly.io default mode)
 *   - Move the scheduler to a dedicated background worker process
 *   - Use a platform cron job (Railway cron, Vercel cron, GitHub Actions) to
 *     POST /api/sync for each shop on a schedule
 *   - Add a DB-level advisory lock inside syncStoreKnowledge to prevent races
 *
 * The per-request isSyncDue() check in chat.jsx serves as an opportunistic
 * fallback if this scheduler is not running.
 */

import prisma from '../db.server.js';
import { syncStoreKnowledge, isSyncDue } from './store-sync.server.js';

let schedulerStarted = false;

export function startSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log('[sync-scheduler] Started — checking every 30 minutes');

  const run = async () => {
    try {
      // Find all shops that have at least one valid (non-expired) offline session.
      // Offline tokens are long-lived (no expiry = null), but guard against stale
      // sessions by filtering out any row whose expires date is in the past.
      const sessions = await prisma.session.findMany({
        where: {
          isOnline: false,
          OR: [
            { expires: null },
            { expires: { gt: new Date() } },
          ],
        },
        select: { shop: true },
      });
      const shops = [...new Set(sessions.map(s => s.shop))];

      if (shops.length === 0) {
        console.log('[sync-scheduler] No shops with valid offline tokens found — skipping tick.');
        return;
      }

      for (const shop of shops) {
        if (await isSyncDue(shop)) {
          console.log(`[sync-scheduler] Triggering sync for ${shop}`);
          syncStoreKnowledge(shop, 'automatic').catch(err =>
            console.error(`[sync-scheduler] Error syncing ${shop}:`, err.message)
          );
        }
      }
    } catch (err) {
      console.error('[sync-scheduler] Scheduler tick error:', err.message);
    }
  };

  // Run once shortly after boot (5 s delay to let the server settle)
  setTimeout(run, 5_000);
  // Then every 30 minutes
  setInterval(run, 30 * 60_000);
}
