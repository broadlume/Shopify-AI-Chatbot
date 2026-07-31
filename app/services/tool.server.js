/**
 * Tool Service
 * MCP catalog tools: use GIDs from MCP response, fetch all display data from Admin GraphQL.
 */
import { saveMessage, getOfflineAccessTokenByShop } from "../db.server";
import AppConfig from "./config.server";

/**
 * @param {Object} opts
 * @param {string} [opts.shopDomain]
 */
export function createToolService({ shopDomain } = {}) {

  // ── Public interface ─────────────────────────────────────────────────────

  const handleToolError = async (toolUseResponse, toolName, toolUseId, conversationHistory, sendMessage, conversationId) => {
    if (toolUseResponse.error.type === "auth_required") {
      await addToolResultToHistory(conversationHistory, toolUseId, toolName, toolUseResponse.error.data, conversationId);
      sendMessage({ type: 'auth_required' });
    } else {
      console.log("Tool use error", toolUseResponse.error);
      // Normalise the error content: prefer .data, fall back to .message (JSON-RPC) or stringify
      const errorContent =
        toolUseResponse.error.data ??
        toolUseResponse.error.message ??
        JSON.stringify(toolUseResponse.error);
      await addToolResultToHistory(conversationHistory, toolUseId, toolName, errorContent, conversationId);
    }
  };

  const handleToolSuccess = async (toolUseResponse, toolName, toolUseId, conversationHistory, productsToDisplay, conversationId) => {
    const catalogToolNames = AppConfig.tools.catalogToolNames || [AppConfig.tools.productSearchName];

    if (catalogToolNames.includes(toolName)) {
      const gids = extractGidsFromMcpResponse(toolUseResponse);
      console.log(`[chatbot] ${toolName}: extracted ${gids.length} GIDs`);

      if (gids.length > 0) {
        // Primary: fetch complete, accurate data from Admin GraphQL
        const adminProducts = await fetchProductsFromAdmin(gids);
        console.log(`[chatbot] Admin GraphQL returned ${adminProducts.length} products`);

        if (adminProducts.length > 0) {
          productsToDisplay.push(...adminProducts);
        } else {
          // Fallback: Admin API unavailable (missing read_products scope or not yet
          // re-authenticated). Extract basic display data directly from the MCP
          // response so cards still appear. URLs may be approximate until re-auth.
          console.warn('[chatbot] Admin API returned no products — using MCP data. Run "shopify app dev --reset" to re-authenticate with read_products scope.');
          const fallback = extractBasicProductsFromMcp(toolUseResponse);
          productsToDisplay.push(...fallback);
        }
      }

      // Augment the tool result sent to the AI with authoritative price data.
      // Shopify APIs return prices in various formats (cents, dollar strings, etc.)
      // — always convert to formatted dollar strings so the AI writes correct prices
      // in its text responses.
      if (productsToDisplay.length > 0) {
        const priceSummary = productsToDisplay.map(p => {
          const price = formatCentsAsDollars(p.price_cents, p.currency_code);
          const compare = p.compare_price_cents
            ? formatCentsAsDollars(p.compare_price_cents, p.currency_code)
            : null;
          return {
            title: p.title,
            price,
            ...(compare ? { compare_at_price: compare } : {}),
            enable_sampling: p.enable_sampling || false,
          };
        });
        const priceNote = '\n\n[VERIFIED_PRICES]\n' +
          JSON.stringify(priceSummary, null, 2) +
          '\n[/VERIFIED_PRICES]\n' +
          'IMPORTANT: Use ONLY the prices above when mentioning product prices. These are the accurate, formatted prices from Shopify.';
        const augmentedContent = Array.isArray(toolUseResponse.content)
          ? [...toolUseResponse.content, { type: 'text', text: priceNote }]
          : (typeof toolUseResponse.content === 'string'
            ? toolUseResponse.content + priceNote
            : toolUseResponse.content);
        await addToolResultToHistory(conversationHistory, toolUseId, toolName, augmentedContent, conversationId);
      } else {
        await addToolResultToHistory(conversationHistory, toolUseId, toolName, toolUseResponse.content, conversationId);
      }
    } else {
      await addToolResultToHistory(conversationHistory, toolUseId, toolName, toolUseResponse.content, conversationId);
    }
  };

  const addToolResultToHistory = async (conversationHistory, toolUseId, toolName, content, conversationId) => {
    const toolResultMessage = {
      role: 'user',
      content: [{ type: "tool_result", tool_use_id: toolUseId, tool_name: toolName, content }],
    };
    conversationHistory.push(toolResultMessage);

    if (conversationId) {
      try {
        await saveMessage(conversationId, 'user', JSON.stringify(toolResultMessage.content));
      } catch (error) {
        console.error('Error saving tool result to database:', error);
      }
    }
  };

  return { handleToolError, handleToolSuccess, addToolResultToHistory, checkSamplingEligibility };

  // ── Price formatting for AI context ──────────────────────────────────────
  // Converts integer cents to a formatted dollar string for the AI to use in
  // its text responses. Uses Intl.NumberFormat for locale-aware formatting.
  function formatCentsAsDollars(cents, currencyCode) {
    const n = Number(cents);
    if (!Number.isFinite(n) || n === 0) return '$0.00';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n / 100);
    } catch {
      return '$' + (n / 100).toFixed(2);
    }
  }

  // ── Sampling eligibility check ───────────────────────────────────────────
  // Dedicated lightweight query for sampling eligibility.
  // Priority: variant metafield → product metafield (variant null/empty falls through).
  // Decision tree:
  //   variant = true               → ALLOW
  //   variant = false              → DENY
  //   variant = null/empty
  //     product = true             → ALLOW
  //     product = false or missing → DENY
  async function checkSamplingEligibility(gids) {
    if (!gids || gids.length === 0) return { allowed: true };

    const accessToken = await getOfflineAccessTokenByShop(shopDomain).catch(() => null);
    if (!accessToken) {
      console.warn('[chatbot] checkSamplingEligibility: no access token, allowing by default');
      return { allowed: true };
    }

    // Fetch both the variant-level AND product-level metafield in one call.
    const query = `
      query CheckSampling($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id title status publishedOnCurrentChannel
            productSampling: metafield(namespace: "additional_data", key: "enable_sampling") { value }
          }
          ... on ProductVariant {
            id title
            variantSampling: metafield(namespace: "additional_data", key: "enable_sampling") { value }
            product {
              id title status publishedOnCurrentChannel
              productSampling: metafield(namespace: "additional_data", key: "enable_sampling") { value }
            }
          }
        }
      }
    `;

    try {
      const res = await fetch(
        `https://${shopDomain}/admin/api/2025-10/graphql.json`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query, variables: { ids: gids } }),
        }
      );

      if (!res.ok) {
        console.warn(`[chatbot] checkSamplingEligibility HTTP ${res.status}, allowing by default`);
        return { allowed: true };
      }

      const payload = await res.json();
      const nodes = payload?.data?.nodes || [];

      for (const node of nodes) {
        if (!node) continue;

        const isVariant = 'variantSampling' in node || (node.product !== undefined);

        if (isVariant) {
          const parentProduct = node.product;
          // Deny sampling for products that aren't active / not on the Online Store
          if (parentProduct?.status !== 'ACTIVE' || parentProduct?.publishedOnCurrentChannel === false) {
            return { allowed: false, denied: parentProduct?.title || node.title || 'product' };
          }

          const variantVal = node.variantSampling?.value ?? null;   // "true" | "false" | null
          const productVal = parentProduct?.productSampling?.value ?? null;
          const productTitle = parentProduct?.title || node.title || 'product';

          console.log(`[chatbot] checkSamplingEligibility variant "${node.title}" variantSampling=${variantVal} productSampling=${productVal}`);

          if (variantVal === 'true') {
            continue; // variant explicitly enabled → allow
          } else if (variantVal === 'false') {
            return { allowed: false, denied: productTitle }; // variant explicitly disabled → deny
          } else {
            // variant is null/empty — defer to product metafield
            if (productVal === 'true') {
              continue; // product enabled → allow
            } else {
              return { allowed: false, denied: productTitle }; // product not enabled → deny
            }
          }
        } else {
          // Direct product GID
          // Deny sampling for products that aren't active / not on the Online Store
          if (node.status !== 'ACTIVE' || node.publishedOnCurrentChannel === false) {
            return { allowed: false, denied: node.title || 'product' };
          }

          const productVal = node.productSampling?.value ?? null;
          console.log(`[chatbot] checkSamplingEligibility product "${node.title}" productSampling=${productVal}`);
          if (productVal !== 'true') {
            return { allowed: false, denied: node.title || 'product' };
          }
        }
      }

      return { allowed: true };
    } catch (err) {
      console.warn('[chatbot] checkSamplingEligibility error:', err.message, '— allowing by default');
      return { allowed: true };
    }
  }
  // Builds cards from the raw MCP catalog response. URLs are inferred from
  // the product title until the app is re-authenticated with read_products scope.

  function extractBasicProductsFromMcp(toolUseResponse) {
    try {
      const content = toolUseResponse?.content?.[0]?.text;
      if (!content) return [];

      let data;
      try { data = typeof content === 'string' ? JSON.parse(content) : content; }
      catch { return []; }

      const items =
        Array.isArray(data?.catalog?.items)    ? data.catalog.items    :
        Array.isArray(data?.catalog?.products) ? data.catalog.products :
        Array.isArray(data?.products)          ? data.products         :
        Array.isArray(data?.items)             ? data.items            :
        data?.product                          ? [data.product]        :
        Array.isArray(data)                    ? data                  : [];

      const toCents = (v) => {
        const raw = v?.amount ?? v;
        if (raw == null || raw === '') return 0;

        // Decimal-looking values are treated as major units (e.g. "29.99").
        // Integer-looking values are treated as minor units/cents (e.g. 2999).
        if (typeof raw === 'number') {
          if (!Number.isFinite(raw)) return 0;
          return Number.isInteger(raw) ? Math.round(raw) : Math.round(raw * 100);
        }

        const s = String(raw).trim();
        if (!s) return 0;
        if (/^-?\d+$/.test(s)) return parseInt(s, 10);

        const normalized = s.includes(',') && !s.includes('.')
          ? s.replace(',', '.')
          : s;
        const n = parseFloat(normalized);
        return isNaN(n) ? 0 : Math.round(n * 100);
      };

      return items
        .filter(item => item?.id && item?.title)
        .slice(0, AppConfig.tools.maxProductsToDisplay)
        .map(item => {
          const inferredHandle = (item.title || '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          const url = item.url || item.onlineStoreUrl ||
            (shopDomain ? `https://${shopDomain}/products/${inferredHandle}` : '');
          const imageUrl = item.media?.[0]?.url || item.featuredImage?.url || '';
          const priceCents = toCents(item.price);

          return {
            id:                  item.id,
            title:               item.title || 'Product',
            price_cents:         priceCents,
            compare_price_cents: 0,
            currency_code:       item.price?.currency || item.price?.currencyCode || 'USD',
            image_url:           imageUrl,
            description:         typeof item.description === 'object'
              ? (item.description?.html || '').replace(/<[^>]*>/g, '')
              : (item.description || ''),
            url,
            handle:              inferredHandle,
            brand:               item.vendor || item.brand || '',
            badge:               Array.isArray(item.tags) && item.tags.includes('new') ? 'New' : '',
          };
        });
    } catch {
      return [];
    }
  }

  // ── Step 1: extract GIDs from MCP catalog response ───────────────────────
  // We only need the IDs — everything else comes from Admin GraphQL.

  function extractGidsFromMcpResponse(toolUseResponse) {
    try {
      const content = toolUseResponse?.content?.[0]?.text;
      if (!content) return [];

      let data;
      try { data = typeof content === 'string' ? JSON.parse(content) : content; }
      catch { return []; }

      // Handle multiple response shapes including UCP catalog wrapper
      const items =
        (Array.isArray(data?.catalog?.items) ? data.catalog.items :
         Array.isArray(data?.catalog?.products) ? data.catalog.products :
         Array.isArray(data?.products)  ? data.products  :
         Array.isArray(data?.items)     ? data.items     :
         Array.isArray(data?.variants)  ? data.variants  :
         data?.product                  ? [data.product] :
         Array.isArray(data)            ? data           : []);

      const gids = [];
      for (const item of items) {
        if (item?.id) gids.push(item.id);
        if (Array.isArray(item?.variants)) {
          for (const v of item.variants) { if (v?.id) gids.push(v.id); }
        }
      }
      return [...new Set(gids)];
    } catch {
      return [];
    }
  }

  // ── Step 2: fetch complete product data from Admin GraphQL (single call) ──
  // Handles both Product and ProductVariant GIDs in one query using inline
  // fragments, so no second request is ever needed.

  async function fetchProductsFromAdmin(gids) {
    if (!shopDomain || !gids.length) return [];

    const accessToken = await getOfflineAccessTokenByShop(shopDomain).catch(() => null);
    if (!accessToken) {
      console.warn('[chatbot] No admin access token — cannot fetch product details');
      return [];
    }

    // One bulk query: Product fragments give data directly; ProductVariant fragments
    // resolve back to the parent product so we never need a second call.
    // We also fetch status and publication state so we can filter out
    // draft/archived products and products not published to the Online Store.
    const query = `
      query FetchProductsBulk($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            status
            descriptionHtml
            vendor
            tags
            publishedOnCurrentChannel
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
            }
            compareAtPriceRange {
              minVariantCompareAtPrice { amount currencyCode }
            }
            featuredImage { url altText }
            enableSampling: metafield(namespace: "additional_data", key: "enable_sampling") { value }
          }
          ... on ProductVariant {
            product {
              id
              title
              handle
              status
              descriptionHtml
              vendor
              tags
              publishedOnCurrentChannel
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
              }
              compareAtPriceRange {
                minVariantCompareAtPrice { amount currencyCode }
              }
              featuredImage { url altText }
              enableSampling: metafield(namespace: "additional_data", key: "enable_sampling") { value }
            }
          }
        }
      }
    `;

    try {
      const response = await fetch(
        `https://${shopDomain}/admin/api/2025-10/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({ query, variables: { ids: gids } }),
        }
      );

      if (!response.ok) {
        console.error(
          `[chatbot] Admin GraphQL HTTP ${response.status} — does the app have the "read_products" scope?` +
          ' Run "shopify app dev --reset" to re-authenticate with updated scopes.'
        );
        return [];
      }

      const payload = await response.json();

      if (payload.errors) {
        console.error('[chatbot] Admin GraphQL errors:', JSON.stringify(payload.errors));
      }

      // Collect unique products (variants point to their parent product)
      // Skip any product that is not ACTIVE or not published to the Online Store.
      const seen = new Set();
      const products = [];

      for (const node of (payload?.data?.nodes || [])) {
        if (!node) continue;
        // Variant → unwrap parent product; Product → use directly
        const product = node.handle !== undefined ? node : node.product;
        if (!product?.id || seen.has(product.id)) continue;

        // Filter: must be ACTIVE and published to the Online Store channel
        if (product.status !== 'ACTIVE') {
          console.log(`[chatbot] Skipping product "${product.title}" — status: ${product.status}`);
          continue;
        }
        if (product.publishedOnCurrentChannel === false) {
          console.log(`[chatbot] Skipping product "${product.title}" — not published on Online Store`);
          continue;
        }

        seen.add(product.id);
        products.push(formatAdminProduct(product));
      }

      return products.slice(0, AppConfig.tools.maxProductsToDisplay);
    } catch (err) {
      console.error('[chatbot] fetchProductsFromAdmin error:', err.message);
      return [];
    }
  }

  // ── Format Admin GraphQL product into display object ─────────────────────

  function formatAdminProduct(product) {
    const minPrice  = product.priceRangeV2?.minVariantPrice;
    const compareAt = product.compareAtPriceRange?.minVariantCompareAtPrice;

    // Return prices as integer cents so the frontend can apply the store's
    // Shopify money format (shop.money_format) accurately.
    const toCents = (amountStr) => Math.round(parseFloat(amountStr || '0') * 100);
    const priceCents       = toCents(minPrice?.amount);
    const comparePriceCents = toCents(compareAt?.amount);

    // Always construct URL from the REAL handle fetched from Admin API.
    // Never rely on onlineStoreUrl — it is null when the product is not
    // published to the Online Store sales channel.
    const url = product.handle
      ? `https://${shopDomain}/products/${product.handle}`
      : '';

    return {
      id:                  product.id,
      title:               product.title || 'Product',
      price_cents:         priceCents,
      compare_price_cents: comparePriceCents > priceCents ? comparePriceCents : 0,
      currency_code:       minPrice?.currencyCode || 'USD',
      image_url:           product.featuredImage?.url || '',
      description:         (product.descriptionHtml || '').replace(/<[^>]*>/g, '').trim(),
      url,
      handle:              product.handle || '',
      brand:               product.vendor || '',
      badge:               Array.isArray(product.tags) && product.tags.includes('new') ? 'New' : '',
      enable_sampling:     product.enableSampling?.value === 'true',
    };
  }
}

export default { createToolService };
