/**
 * Sync Scheduler
 * Starts a 30-minute interval on server boot.  Each tick checks every shop
 * that has an offline token and syncs if 30+ minutes have elapsed since the
 * last successful sync.  Isolated per shopDomain — no cross-store leakage.
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
      // Find all shops with an offline token
      const sessions = await prisma.session.findMany({
        where: { isOnline: false },
        select: { shop: true },
      });
      const shops = [...new Set(sessions.map(s => s.shop))];

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
