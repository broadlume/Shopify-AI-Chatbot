/**
 * Public endpoint — returns preset config JSON for a given shop.
 * Used by the chat widget to load customised welcome screen content.
 * No authentication required; no sensitive data is exposed.
 */
import { getShopConfig } from '../db.server.js';
import { DEFAULT_PRESET } from '../services/preset-defaults.server.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=120',
  'Content-Type': 'application/json',
};

export async function loader({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) {
    return new Response(JSON.stringify(DEFAULT_PRESET), { headers: CORS });
  }

  const config = await getShopConfig(shop).catch(() => null);
  let preset = DEFAULT_PRESET;

  if (config?.presetConfig) {
    try { preset = { ...DEFAULT_PRESET, ...JSON.parse(config.presetConfig) }; } catch {}
  }

  return new Response(JSON.stringify(preset), { headers: CORS });
}
