/**
 * Store Sync Service — optimised for accuracy and large stores.
 *
 * Design principles:
 * - Never iterate individual products for large catalogs; use aggregation queries.
 * - Cursor-based pagination for collections and pages (handles 10k+ records).
 * - Store compact JSON summaries, not raw records.
 * - All data is keyed by shopDomain — zero cross-store leakage.
 */

import prisma from '../db.server.js';
import { getOfflineAccessTokenByShop } from '../db.server.js';
const API_VERSION = '2025-10';
const BATCH = 250; // Max nodes per GraphQL page

async function adminQuery(shopDomain, accessToken, query, variables = {}) {
  const res = await fetch(
    `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) throw new Error(`Admin API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

/** Paginate through a connection field and collect all nodes. */
async function paginateAll(shopDomain, accessToken, buildQuery, extractPage, maxPages = 40) {
  const nodes = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const data = await adminQuery(shopDomain, accessToken, buildQuery(BATCH, cursor));
    const page = extractPage(data);
    nodes.push(...(page.nodes ?? []));
    if (!page.pageInfo?.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return nodes;
}

async function updateProgress(shopDomain, progress) {
  await prisma.syncStatus.upsert({
    where: { shopDomain },
    create: { shopDomain, status: 'running', progress },
    update: { status: 'running', progress },
  });
}

async function upsertKnowledge(shopDomain, type, content) {
  await prisma.storeKnowledge.upsert({
    where: { shopDomain_type: { shopDomain, type } },
    create: { shopDomain, type, content: JSON.stringify(content) },
    update: { content: JSON.stringify(content) },
  });
}

// ─── Top-level tag frequency helper ────────────────────────────────────────
// Samples up to `sampleSize` best-selling products and returns the top N tags
// sorted by frequency. Efficient: one query, no full catalog scan.
// Only includes ACTIVE products published to the Online Store sales channel.
async function sampleTopTags(shopDomain, accessToken, sampleSize = 200, topN = 30) {
  const data = await adminQuery(shopDomain, accessToken, `{
    products(first: ${sampleSize}, sortKey: UPDATED_AT, query: "status:ACTIVE published_status:published") {
      nodes { tags }
    }
  }`);
  const freq = {};
  for (const p of (data.products?.nodes ?? [])) {
    for (const tag of (p.tags ?? [])) {
      const t = tag.toLowerCase().trim();
      if (t) freq[t] = (freq[t] ?? 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => tag);
}

// ─── Price range per product type ──────────────────────────────────────────
// Samples best-selling products per type for a price-range summary.
// Only includes ACTIVE products published to the Online Store sales channel.
async function priceRangesByType(shopDomain, accessToken) {
  const data = await adminQuery(shopDomain, accessToken, `{
    products(first: 250, sortKey: UPDATED_AT, query: "status:ACTIVE published_status:published") {
      nodes { productType priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } } }
    }
  }`);
  const byType = {};
  for (const p of (data.products?.nodes ?? [])) {
    const t = p.productType?.trim();
    if (!t) continue;
    const min = parseFloat(p.priceRangeV2?.minVariantPrice?.amount ?? '0');
    const max = parseFloat(p.priceRangeV2?.maxVariantPrice?.amount ?? '0');
    const cur = p.priceRangeV2?.minVariantPrice?.currencyCode ?? 'USD';
    if (!byType[t]) byType[t] = { min, max, cur };
    else { byType[t].min = Math.min(byType[t].min, min); byType[t].max = Math.max(byType[t].max, max); }
  }
  // Store integer cents so all frontend price formatters can apply
  // Shopify money formatting consistently.
  return Object.entries(byType).map(([type, r]) => ({
    type,
    min: Math.round(r.min * 100),
    max: Math.round(r.max * 100),
    currency: r.cur,
  }));
}

// ─── Variant product_details metafield sampling ────────────────────────────
// Strategy: fetch metafield DEFINITIONS first (cheap, tells us what keys exist
// and their human labels), then sample best-selling products' variants to
// collect representative values per key.  Never scans the full catalog.
async function sampleVariantSpecs(shopDomain, accessToken) {
  // 1. Definitions — what specs does this store configure?
  let definitions = [];
  try {
    const defData = await adminQuery(shopDomain, accessToken, `{
      metafieldDefinitions(ownerType: PRODUCTVARIANT, namespace: "product_details", first: 50) {
        nodes { key name description type { name } }
      }
    }`);
    definitions = defData.metafieldDefinitions?.nodes ?? [];
  } catch (e) {
    console.warn(`[sync] variant spec definitions skipped: ${e.message}`);
    return null;
  }
  if (!definitions.length) return null;

  // 2. Sample values: best-selling products → first 2 variants → product_details
  // Only ACTIVE products published to the Online Store sales channel.
  const sampleData = await adminQuery(shopDomain, accessToken, `{
    products(first: 60, sortKey: UPDATED_AT, query: "status:ACTIVE published_status:published") {
      nodes {
        productType
        variants(first: 2) {
          nodes {
            metafields(namespace: "product_details", first: 50) {
              nodes { key value }
            }
          }
        }
      }
    }
  }`);

  // 3. Aggregate: collect unique non-empty values per key (capped at 15 per key)
  const valueMap = {}; // key → Set<value>
  for (const product of (sampleData.products?.nodes ?? [])) {
    for (const variant of (product.variants?.nodes ?? [])) {
      for (const mf of (variant.metafields?.nodes ?? [])) {
        if (!mf.key || !mf.value) continue;
        if (!valueMap[mf.key]) valueMap[mf.key] = new Set();
        // Parse JSON arrays/objects to plain strings for readability
        let val = mf.value;
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) val = parsed.join(', ');
          else if (typeof parsed === 'object') val = JSON.stringify(parsed);
          else val = String(parsed);
        } catch {}
        if (val.length <= 200) valueMap[mf.key].add(val);
      }
    }
  }

  // 4. Build compact output: definitions with sample values
  const specs = definitions.map(def => ({
    key: def.key,
    name: def.name,
    type: def.type?.name,
    description: def.description ?? null,
    sampleValues: [...(valueMap[def.key] ?? [])].slice(0, 15),
  })).filter(s => s.sampleValues.length > 0 || definitions.length < 20);
  // Include all definitions even without samples if the store has few fields

  return specs;
}

// ─── Main sync ──────────────────────────────────────────────────────────────
export async function syncStoreKnowledge(shopDomain, trigger = 'automatic') {
  const existing = await prisma.syncStatus.findUnique({ where: { shopDomain } });
  if (existing?.status === 'running') return;

  const logEntry = await prisma.syncLog.create({ data: { shopDomain, trigger, status: 'running' } });

  await prisma.syncStatus.upsert({
    where: { shopDomain },
    create: { shopDomain, status: 'running', progress: 'Starting…' },
    update: { status: 'running', progress: 'Starting…', error: null },
  });

  try {
    const accessToken = await getOfflineAccessTokenByShop(shopDomain);
    if (!accessToken) {
      throw new Error(
        'No offline access token found for this shop. ' +
        'The app needs to be reinstalled so Shopify can issue a fresh offline token. ' +
        'In your Shopify Partner Dashboard → Apps → select your app → Test on development store, ' +
        'or ask the merchant to reinstall the app from the Shopify App Store.'
      );
    }

    // ── 1. Shop summary + product counts (single fast query) ───────────────
    await updateProgress(shopDomain, 'Fetching shop info…');
    const shopData = await adminQuery(shopDomain, accessToken, `{
      shop {
        name description
        primaryDomain { host }
        ianaTimezone
      }
      productsCount { count }
      collectionsCount { count }
    }`);
    await upsertKnowledge(shopDomain, 'summary', {
      name: shopData.shop.name,
      description: shopData.shop.description,
      domain: shopData.shop.primaryDomain?.host,
      timezone: shopData.shop.ianaTimezone,
      totalProducts: shopData.productsCount?.count ?? 0,
      totalCollections: shopData.collectionsCount?.count ?? 0,
    });

    // ── 2. All product types (indexed query — fast even for 100k products) ──
    await updateProgress(shopDomain, 'Fetching product types…');
    const typesData = await adminQuery(shopDomain, accessToken, `{
      productTypes(first: 250) { edges { node } }
    }`);
    const productTypes = typesData.productTypes.edges
      .map(e => e.node?.trim()).filter(Boolean);
    await upsertKnowledge(shopDomain, 'productTypes', productTypes);

    // ── 3. Top tags from best-selling sample ────────────────────────────────
    await updateProgress(shopDomain, 'Sampling product tags…');
    const topTags = await sampleTopTags(shopDomain, accessToken, 200, 40);
    await upsertKnowledge(shopDomain, 'topTags', topTags);

    // ── 4. Price ranges per product type (from best-selling sample) ─────────
    await updateProgress(shopDomain, 'Sampling price ranges…');
    const priceRanges = await priceRangesByType(shopDomain, accessToken);
    await upsertKnowledge(shopDomain, 'priceRanges', priceRanges);

    // ── 5. All collections with cursor pagination ────────────────────────────
    // Each page: 250 collections. Stores only what's needed for grounding.
    await updateProgress(shopDomain, 'Fetching collections…');
    const collNodes = await paginateAll(
      shopDomain, accessToken,
      (first, after) => `{
        collections(first: ${first}${after ? `, after: "${after}"` : ''}) {
          nodes { title handle productsCount { count } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      d => d.collections
    );
    await upsertKnowledge(shopDomain, 'collections',
      collNodes.map(c => ({ title: c.title, handle: c.handle, productCount: c.productsCount?.count ?? 0 }))
    );

    // ── 5b. Variant product_details metafields ─────────────────────────────
    // Fetches spec definitions + samples representative values per key.
    await updateProgress(shopDomain, 'Sampling variant specifications…');
    const variantSpecs = await sampleVariantSpecs(shopDomain, accessToken);
    if (variantSpecs) {
      await upsertKnowledge(shopDomain, 'variantSpecs', variantSpecs);
    }

    // ── 6. Pages with cursor pagination (requires read_content) ────────────
    await updateProgress(shopDomain, 'Fetching pages…');
    try {
      const pageNodes = await paginateAll(
        shopDomain, accessToken,
        (first, after) => `{
          pages(first: ${first}${after ? `, after: "${after}"` : ''}) {
            nodes { title handle }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        d => d.pages
      );
      await upsertKnowledge(shopDomain, 'pages',
        pageNodes.map(p => ({ title: p.title, handle: p.handle }))
      );
    } catch (e) {
      console.warn(`[sync] ${shopDomain}: pages skipped (${e.message})`);
    }

    // ── 7. Blogs + recent articles (requires read_content) ─────────────────
    await updateProgress(shopDomain, 'Fetching blogs & articles…');
    try {
      const blogData = await adminQuery(shopDomain, accessToken, `{
        blogs(first: 50) {
          nodes {
            title handle
            articles(first: 10) {
              nodes { title handle }
            }
          }
        }
      }`);
      await upsertKnowledge(shopDomain, 'blogs',
        blogData.blogs.nodes.map(b => ({
          title: b.title, handle: b.handle,
          articles: b.articles.nodes.map(a => ({ title: a.title, handle: a.handle })),
        }))
      );
    } catch (e) {
      console.warn(`[sync] ${shopDomain}: blogs skipped (${e.message})`);
    }

    // ── 8. FAQ knowledge (from app DB — no Admin API call needed) ────────────
    await updateProgress(shopDomain, 'Syncing FAQ knowledge…');
    const faqEntries = await prisma.faqEntry.findMany({
      where: { shopDomain, published: true },
      select: { question: true, answer: true, tags: true },
      orderBy: { updatedAt: 'desc' },
    });
    await upsertKnowledge(shopDomain, 'faqs',
      faqEntries.map(f => ({ q: f.question, a: f.answer, tags: f.tags ?? null }))
    );

    // ── Done ────────────────────────────────────────────────────────────────
    const now = new Date();
    await Promise.all([
      prisma.syncStatus.update({
        where: { shopDomain },
        data: { status: 'completed', progress: 'Sync complete', lastSyncAt: now, error: null },
      }),
      prisma.syncLog.update({ where: { id: logEntry.id }, data: { status: 'completed', completedAt: now } }),
    ]);
    console.log(`[sync] ${shopDomain}: completed`);
  } catch (err) {
    console.error(`[sync] ${shopDomain}: failed —`, err.message);
    const now = new Date();
    await Promise.all([
      prisma.syncStatus.upsert({
        where: { shopDomain },
        create: { shopDomain, status: 'failed', error: err.message },
        update: { status: 'failed', error: err.message, progress: null },
      }),
      prisma.syncLog.update({ where: { id: logEntry.id }, data: { status: 'failed', error: err.message, completedAt: now } }).catch(e => console.error('[sync] Failed to update SyncLog:', e.message)),
    ]);
  }
}

export async function getStoreKnowledge(shopDomain) {
  const rows = await prisma.storeKnowledge.findMany({ where: { shopDomain } });
  const map = {};
  for (const row of rows) {
    try { map[row.type] = JSON.parse(row.content); } catch { map[row.type] = null; }
  }
  return map;
}

/**
 * Build a compact, accurate knowledge block for injection into the system prompt.
 * Kept to ~15 lines max to minimise token cost while maximising AI grounding.
 */
export function buildKnowledgeSummary(knowledge) {
  if (!knowledge || !Object.keys(knowledge).length) return '';

  const lines = ['=== STORE KNOWLEDGE — answer questions using ONLY facts listed here ==='];

  const s = knowledge.summary;
  if (s) {
    lines.push(`Store: ${s.name ?? 'Unknown'}${s.domain ? ` (${s.domain})` : ''}`);
    if (s.description) lines.push(`Description: ${s.description.slice(0, 200)}`);
    if (s.totalProducts) lines.push(`Total products: ${s.totalProducts.toLocaleString()} | Collections: ${s.totalCollections ?? '?'}`);
  }

  if (Array.isArray(knowledge.productTypes) && knowledge.productTypes.length) {
    lines.push(`Product types sold: ${knowledge.productTypes.join(', ')}`);
  }

  if (Array.isArray(knowledge.priceRanges) && knowledge.priceRanges.length) {
    // priceRanges are stored as { type, min, max, currency } where min/max are integer cents
    const ranges = knowledge.priceRanges.slice(0, 8).map(r => {
      const fmt = (cents, currency) => {
        try {
          return new Intl.NumberFormat('en-US', {
            style: 'currency', currency: currency || 'USD',
            minimumFractionDigits: 0, maximumFractionDigits: 0,
          }).format(cents / 100);
        } catch {
          return `$${(cents / 100).toFixed(0)}`;
        }
      };
      const minStr = fmt(r.min, r.currency);
      const maxStr = fmt(r.max, r.currency);
      return r.min === r.max ? `${r.type} (${minStr})` : `${r.type} (${minStr}–${maxStr})`;
    }).join(', ');
    lines.push(`Price ranges: ${ranges}`);
  }

  if (Array.isArray(knowledge.topTags) && knowledge.topTags.length) {
    lines.push(`Top product tags/attributes: ${knowledge.topTags.slice(0, 25).join(', ')}`);
  }

  if (Array.isArray(knowledge.collections) && knowledge.collections.length) {
    const top = knowledge.collections.slice(0, 12).map(c => `${c.title} (${c.productCount})`).join(', ');
    const more = knowledge.collections.length > 12 ? ` + ${knowledge.collections.length - 12} more` : '';
    lines.push(`Collections: ${top}${more}`);
  }

  if (Array.isArray(knowledge.variantSpecs) && knowledge.variantSpecs.length) {
    lines.push('Product specifications (product_details namespace on variants):');
    for (const spec of knowledge.variantSpecs.slice(0, 20)) {
      const vals = spec.sampleValues.length
        ? ` → ${spec.sampleValues.slice(0, 8).join(' | ')}`
        : '';
      lines.push(`  ${spec.name ?? spec.key} (${spec.key})${spec.description ? ` — ${spec.description}` : ''}${vals}`);
    }
  }

  if (Array.isArray(knowledge.pages) && knowledge.pages.length) {
    lines.push(`Pages: ${knowledge.pages.map(p => p.title).join(', ')}`);
  }

  if (Array.isArray(knowledge.blogs) && knowledge.blogs.length) {
    const bs = knowledge.blogs.map(b => `${b.title} (${b.articles.length} articles)`).join(', ');
    lines.push(`Blogs: ${bs}`);
  }

  if (Array.isArray(knowledge.faqs) && knowledge.faqs.length) {
    lines.push(`Store FAQs (${knowledge.faqs.length} entries):`);
    for (const faq of knowledge.faqs.slice(0, 30)) {
      lines.push(`  Q: ${faq.q}`);
      lines.push(`  A: ${faq.a.slice(0, 300)}${faq.a.length > 300 ? '…' : ''}`);
    }
  }

  lines.push(
    'IMPORTANT: Only discuss products, collections, and content that are listed above. ' +
    'If asked about something not in this list, say you are not sure and offer to search.'
  );
  lines.push('=== END STORE KNOWLEDGE ===');
  return lines.join('\n');
}

export async function isSyncDue(shopDomain) {
  const status = await prisma.syncStatus.findUnique({ where: { shopDomain } });
  if (!status?.lastSyncAt) return true;
  return (Date.now() - new Date(status.lastSyncAt).getTime()) / 60_000 >= 30;
}
