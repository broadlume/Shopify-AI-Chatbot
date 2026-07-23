/**
 * API: Trigger a manual store knowledge sync and stream progress via SSE.
 * POST /api/sync  →  starts sync for the authenticated shop
 * GET  /api/sync  →  SSE stream of SyncStatus.progress updates
 */

import { authenticate } from '../shopify.server';
import { syncStoreKnowledge } from '../services/store-sync.server.js';
import { getSyncStatus } from '../db.server.js';

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Fire-and-forget — client polls via the loader SSE
  syncStoreKnowledge(shopDomain).catch(err =>
    console.error('[sync] Manual trigger error:', err.message)
  );

  return new Response(JSON.stringify({ started: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const status = await getSyncStatus(shopDomain);
  return new Response(JSON.stringify(status ?? { status: 'idle' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
