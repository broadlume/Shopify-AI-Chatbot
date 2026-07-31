/**
 * Chat API Route
 * Handles chat interactions with the configured AI model and tools
 */
import MCPClient from "../mcp-client";
import { saveMessage, getConversationHistory, storeCustomerAccountUrls, getCustomerAccountUrls as getCustomerAccountUrlsFromDb, createQueryLog, getShopConfig } from "../db.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import { createFaqToolService } from "../services/faq.server";
import { createProductMetafieldsToolService } from "../services/product-metafields.server";
import { getStoreKnowledge, buildKnowledgeSummary, isSyncDue, syncStoreKnowledge } from "../services/store-sync.server.js";

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Limits POST /chat requests to RATE_LIMIT_MAX per RATE_LIMIT_WINDOW_MS per
// shop domain. Resets automatically when the window expires.
// Note: this is per-process — in multi-worker deployments each worker has its
// own counter. For stricter enforcement use Redis/Upstash.
const RATE_LIMIT_MAX = 30;           // max requests per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1-minute sliding window

/** @type {Map<string, {count: number, resetAt: number}>} */
const _rateLimitStore = new Map();

/**
 * Check and update the rate limit for a given key (typically shop domain).
 * Returns true if the request should be BLOCKED.
 */
function isRateLimited(key) {
  const now = Date.now();
  const entry = _rateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    // New window
    _rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return true; // blocked
  }
  return false;
}

// Periodically clean up expired entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _rateLimitStore) {
    if (now >= entry.resetAt) _rateLimitStore.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS);


/**
 * Extract cart line items (with quantity) from cart mutation tool arguments.
 * Used to build the /cart/add.js payload for the browser-side cart.
 */
function extractCartItemsFromArgs(toolArgs) {
  if (!toolArgs) return [];

  // Log the raw args so we can see exactly what the MCP passes
  console.log('[chatbot] extractCartItemsFromArgs raw toolArgs:', JSON.stringify(toolArgs, null, 2));

  const items = [];

  // ── Known structured formats ──────────────────────────────────────────
  // Format A: { lines: [{ merchandiseId, quantity }] }  (Storefront API style)
  if (Array.isArray(toolArgs.lines)) {
    toolArgs.lines.forEach(line => {
      const id = line.merchandiseId || line.variantId || line.variant_id || '';
      if (id) items.push({ id: String(id), quantity: line.quantity ?? 1, properties: line.attributes || line.properties || {} });
    });
  }

  // Format B: { items: [{ variantId / merchandiseId, quantity }] }
  if (Array.isArray(toolArgs.items)) {
    toolArgs.items.forEach(item => {
      const id = item.merchandiseId || item.variantId || item.variant_id || item.id || '';
      if (id) items.push({ id: String(id), quantity: item.quantity ?? 1, properties: item.properties || {} });
    });
  }

  // Format C: direct top-level fields
  const directId = toolArgs.merchandiseId || toolArgs.variantId || toolArgs.variant_id;
  if (directId && !items.length) {
    items.push({ id: String(directId), quantity: toolArgs.quantity ?? 1 });
  }

  // We removed the recursive fallback to prevent accidental mass-additions of 
  // related products or upsells that might be present in the tool arguments.

  console.log('[chatbot] extractCartItemsFromArgs result:', JSON.stringify(items));
  return items;
}

/**
 * Cart mutation tool names that require enable_sampling validation.
 * Any tool name containing "cart" (case-insensitive) that is not a read-only
 * "get_cart" is treated as a mutation.
 */
const CART_MUTATION_TOOLS = new Set(['update_cart', 'add_to_cart', 'cart_lines_add', 'cartLinesAdd', 'cartLinesUpdate', 'cartLinesRemove']);

function isCartMutation(toolName) {
  if (CART_MUTATION_TOOLS.has(toolName)) return true;
  const lower = toolName.toLowerCase();
  return lower.includes('cart') && !lower.startsWith('get_cart') && lower !== 'get_cart';
}

/**
 * Extract ProductVariant GIDs from cart mutation tool arguments.
 * Handles the Shopify Storefront MCP update_cart format as well as common alternatives.
 */
function extractVariantGidsFromCartArgs(toolArgs) {
  if (!toolArgs) return [];
  const gids = [];

  // update_cart format: { lines: [{ merchandiseId: "gid://shopify/ProductVariant/..." }] }
  if (Array.isArray(toolArgs.lines)) {
    toolArgs.lines.forEach(line => {
      if (line.merchandiseId) gids.push(line.merchandiseId);
      if (line.variantId)     gids.push(line.variantId);
    });
  }
  // Direct fields
  if (toolArgs.merchandiseId) gids.push(toolArgs.merchandiseId);
  if (toolArgs.variantId)     gids.push(toolArgs.variantId);

  return gids.filter(g => typeof g === 'string' && g.includes('ProductVariant'));
}

/**
 * Parse the MCP cart tool response to return the raw cart data object.
 * MCP content blocks contain JSON text; we parse it so the frontend can
 * forward it to the Shopify theme pub/sub system.
 */
function extractCartDataFromMcpResponse(toolUseResponse) {
  try {
    const blocks = Array.isArray(toolUseResponse.content)
      ? toolUseResponse.content
      : [];
    for (const block of blocks) {
      if (block?.text) {
        const parsed = JSON.parse(block.text);
        if (parsed) return parsed;
      }
    }
  } catch (_) {}
  return toolUseResponse.content ?? null;
}

/**
/**
 * React Router loader function for handling GET requests
 */
export async function loader({ request }) {
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);

  // Handle history fetch requests - matches /chat?history=true&conversation_id=XYZ
  if (url.searchParams.has('history') && url.searchParams.has('conversation_id')) {
    return handleHistoryRequest(request, url.searchParams.get('conversation_id'));
  }

  // Handle SSE requests
  if (!url.searchParams.has('history') && request.headers.get("Accept") === "text/event-stream") {
    return handleChatRequest(request);
  }

  // API-only: reject all other requests
  return new Response(JSON.stringify({ error: AppConfig.errorMessages.apiUnsupported }), { status: 400, headers: getCorsHeaders(request) });
}

/**
 * React Router action function for handling POST requests
 */
export async function action({ request }) {
  // OPTIONS preflight — React Router routes OPTIONS to the action, not the loader
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  // ── Rate limiting ───────────────────────────────────────────────────────────
  // Key by shop domain inferred from Origin/Referer headers.
  // Falls back to IP-based limiting via X-Forwarded-For if shop domain is absent.
  const rateLimitKey = (() => {
    const originHeader = request.headers.get('Origin');
    const refererHeader = request.headers.get('Referer');
    try {
      if (originHeader) return new URL(originHeader).hostname;
      if (refererHeader) return new URL(refererHeader).hostname;
    } catch {}
    return request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
  })();

  if (isRateLimited(rateLimitKey)) {
    console.warn(`[chat] Rate limit exceeded for key: ${rateLimitKey}`);
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please wait a moment before sending another message.' }),
      {
        status: 429,
        headers: {
          ...getCorsHeaders(request),
          'Content-Type': 'application/json',
          'Retry-After': '60',
        }
      }
    );
  }

  try {
    return await handleChatRequest(request);
  } catch (error) {
    console.error('Unhandled error in chat action:', error);
    return new Response(JSON.stringify({ error: 'An internal server error occurred. Please try again later.' }), {
      status: 500,
      headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle history fetch requests.
 * Validates that the requesting origin belongs to the same shop as the
 * conversation — prevents cross-origin history exfiltration.
 * @param {Request} request - The request object
 * @param {string} conversationId - The conversation ID
 * @returns {Response} JSON response with chat history
 */
async function handleHistoryRequest(request, conversationId) {
  // Infer shop domain from the Origin or Referer header
  const originHeader = request.headers.get('Origin');
  const refererHeader = request.headers.get('Referer');
  let requestingHost = null;
  try {
    if (originHeader) requestingHost = new URL(originHeader).hostname;
    else if (refererHeader) requestingHost = new URL(refererHeader).hostname;
  } catch {}

  if (!requestingHost) {
    return new Response(
      JSON.stringify({ error: 'Missing Origin header — history endpoint requires a browser origin.' }),
      { status: 403, headers: getCorsHeaders(request) }
    );
  }

  // Validate: the requesting host must be a myshopify.com domain or the
  // shop's custom domain. We do a lightweight check here; tighten if needed.
  // Shopify storefronts always send their shop domain as Origin.
  const isShopifyHost = requestingHost.endsWith('.myshopify.com') ||
    requestingHost.endsWith('.shopify.com') ||
    requestingHost.endsWith('.shopifypreview.com');

  if (!isShopifyHost) {
    // Allow if the origin matches the app's own host (for admin UI previews)
    const appHost = process.env.SHOPIFY_APP_URL
      ? new URL(process.env.SHOPIFY_APP_URL).hostname
      : null;
    if (requestingHost !== appHost) {
      console.warn(`[chat] History request blocked for non-Shopify origin: ${requestingHost}`);
      return new Response(
        JSON.stringify({ error: 'Forbidden: history endpoint is only accessible from Shopify storefronts.' }),
        { status: 403, headers: getCorsHeaders(request) }
      );
    }
  }

  const explicitShopDomain = request.headers.get("X-Shopify-Shop-Domain");
  const shopDomain = explicitShopDomain || requestingHost;

  const messages = await getConversationHistory(conversationId, shopDomain);
  return new Response(JSON.stringify({ messages }), { headers: getCorsHeaders(request) });
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  try {
    // Get message data from request body
    const body = await request.json();
    const userMessage = body.message;
    // display_message is the clean user text without any injected product-context
    // prefix; it is what gets stored in the DB and shown on history reload.
    const displayMessage = body.display_message || userMessage;

    // Validate required message
    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || AppConfig.api.defaultPromptType;

    // Create a stream for the response
    const responseStream = createSseStream(async (stream) => {
      await handleChatSession({
        request,
        userMessage,
        displayMessage,
        conversationId,
        promptType,
        stream
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request)
    });
  } catch (error) {
    console.error('Error in chat request handler:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: getCorsHeaders(request)
    });
  }
}

/**
 * Handle a complete chat session
 * @param {Object} params - Session parameters
 * @param {Request} params.request - The request object
 * @param {string} params.userMessage - The user's message
 * @param {string} params.conversationId - The conversation ID
 * @param {string} params.promptType - The prompt type
 * @param {Object} params.stream - Stream manager for sending responses
 */
async function handleChatSession({
  request,
  userMessage,
  displayMessage,
  conversationId,
  promptType,
  stream
}) {
  // Initialize services
  const claudeService = createClaudeService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const explicitShopDomain = request.headers.get("X-Shopify-Shop-Domain");
  const originHeader = request.headers.get("Origin");
  const refererHeader = request.headers.get("Referer");
  const shopOrigin = originHeader || (refererHeader ? new URL(refererHeader).origin : '');
  const inferredDomain = shopOrigin ? new URL(shopOrigin).hostname : '';
  const shopDomain = explicitShopDomain || inferredDomain;
  const mcpHost = shopOrigin || (shopDomain ? `https://${shopDomain}` : '');

  if (!shopDomain || !mcpHost) {
    throw new Error('Unable to determine shop domain from request headers');
  }

  // toolService needs shopDomain to resolve real product URLs from Admin GraphQL
  const toolService = createToolService({ shopDomain });
  const { mcpApiUrl } = await getCustomerAccountUrls(shopDomain, conversationId);
  const faqToolService = createFaqToolService({ shopDomain });
  const productMetafieldsToolService = createProductMetafieldsToolService({ shopDomain });

  const mcpClient = new MCPClient(
    mcpHost,
    conversationId,
    shopId,
    mcpApiUrl,
  );

  try {
    // Send conversation ID + any app-admin settings overrides to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });
    const shopConfig = shopDomain ? await getShopConfig(shopDomain).catch(() => null) : null;
    if (shopConfig) {
      stream.sendMessage({ type: 'shop_config', config: shopConfig });
    }

    // Connect to MCP servers and get available tools
    let storefrontMcpTools = [], customerMcpTools = [];

    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();

      console.log(`Connected to MCP with ${storefrontMcpTools.length} tools`);
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
    } catch (error) {
      console.warn('Failed to connect to MCP servers, continuing without tools:', error.message);
    }

    // Prepare conversation state
    let conversationHistory = [];
    let productsToDisplay = [];
    // Tracks the last assistant message DB save so product_results is always
    // persisted AFTER it (avoids identical createdAt causing reversed replay order).
    let lastAssistantSavePromise = Promise.resolve();

    // Save user message to the database.
    // Use displayMessage (the clean text without any injected product-context prefix)
    // so history replay shows the original user words, not the AI prompt context.
    await saveMessage(conversationId, 'user', displayMessage ?? userMessage, shopDomain);

    // Fetch all messages from the database for this conversation
    const dbMessages = await getConversationHistory(conversationId, shopDomain);

    // Format messages for AI API
    conversationHistory = dbMessages.map(dbMessage => {
      let content;
      try {
        const parsed = JSON.parse(dbMessage.content);
        content = parsed;
      } catch (e) {
        content = dbMessage.content;
      }
      return {
        role: dbMessage.role,
        content,
      };
    });

    // The DB stores the clean display_message, but the AI must receive
    // the FULL userMessage which may include a [PINNED_PRODUCT_CONTEXT] block.
    if (conversationHistory.length > 0) {
      const lastMsg = conversationHistory[conversationHistory.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = userMessage;
      }
    }

    // ── Store knowledge injection ──────────────────────────────────────────
    // Fetch the per-shop catalog snapshot and prepend it to the system prompt.
    // If the data is stale (> 30 min), kick off a background refresh.
    let storeKnowledgeSummary = '';
    if (shopDomain) {
      const knowledge = await getStoreKnowledge(shopDomain);
      if (Object.keys(knowledge).length > 0) {
        storeKnowledgeSummary = buildKnowledgeSummary(knowledge);
      }
      // Background refresh if overdue (don't await — keep response fast)
      isSyncDue(shopDomain).then(due => {
        if (due) syncStoreKnowledge(shopDomain).catch(() => {});
      }).catch(() => {});
    }

    // ── Proactive FAQ injection ────────────────────────────────────────────
    // Always search the store FAQ for the current query and, if matches are
    // found, append them to the last user message so the AI has the answers
    // in context even if it decides not to call search_store_faqs itself.
    try {
      const faqPreload = await faqToolService.executeTool('search_store_faqs', {
        query: displayMessage,
        limit: 5,
      });
      const faqPreloadData = JSON.parse(faqPreload?.content?.[0]?.text || '{"faqs":[]}');
      if (faqPreloadData.faqs?.length > 0) {
        const faqBlock = faqPreloadData.faqs
          .map(f => `Q: ${f.question}\nA: ${f.answer}`)
          .join('\n\n');
        const injectText = `\n\n[STORE FAQ SEARCH RESULTS — use these to answer the customer if relevant]\n${faqBlock}\n[END FAQ RESULTS]`;
        // Append to the last user message in history (current turn)
        if (conversationHistory.length > 0) {
          const last = conversationHistory[conversationHistory.length - 1];
          if (last.role === 'user') {
            last.content = (typeof last.content === 'string' ? last.content : userMessage) + injectText;
          }
        }
        console.log(`[chat] FAQ pre-fetch: injected ${faqPreloadData.faqs.length} result(s) for query "${displayMessage}"`);
      } else {
        console.log(`[chat] FAQ pre-fetch: no matches found for query "${displayMessage}"`);
      }
    } catch (faqErr) {
      console.warn('[chat] FAQ pre-fetch error:', faqErr.message);
    }

    // ── Debug: log all tools available to the AI ──────────────────────────
    const allTools = [
      ...mcpClient.tools,
      ...faqToolService.getTools(),
      ...productMetafieldsToolService.getTools(),
    ];
    console.log(`[chat] ── New turn ── shop=${shopDomain} conversation=${conversationId}`);
    console.log(`[chat] User query: ${displayMessage}`);
    console.log(`[chat] Tools available (${allTools.length}): ${allTools.map(t => t.name).join(', ')}`);

    // Execute the conversation stream
    let finalMessage = { role: 'user', content: userMessage };
    let turnIndex = 0;
    // ── Query-log tracking ────────────────────────────────────────────────
    // Signals set during the conversation turn; resolved into a reason at the end.
    let lastAssistantText  = '';
    let hadToolError       = false;   // any MCP/local tool returned an error
    let catalogToolCalled  = false;   // a product-search tool was invoked

    // Phrases that indicate the AI got no useful results from the store data
    const NO_RESULTS_PHRASES = [
      "couldn't find", "could not find", "wasn't able to find",
      "unable to find", "no results", "no products", "no items found",
      "not in our catalog", "we don't carry", "we don't have",
      "we don't offer", "don't have any", "i don't see any",
      "nothing matching", "no matching",
    ];
    // Phrases that indicate the question is outside the assistant's scope
    const OUT_OF_SCOPE_PHRASES = [
      "i'm not able to help with that", "i can't help with that",
      "outside the scope", "outside what i can help",
      "beyond what i can assist", "i'm only here to help with",
      "i can only assist with", "i can only help with",
      "contact customer support", "contact our support",
      "reach out to our team", "please contact us directly",
    ];
    // Phrases that indicate the AI is uncertain or confused
    const UNCERTAIN_PHRASES = [
      "i don't have information", "i'm not sure", "i cannot find",
      "i don't know", "i'm unable to", "no information available",
      "outside my knowledge", "can't find",
      "didn't quite catch", "couldn't quite catch", "not sure what you",
      "could you please clarify", "could you clarify", "could you rephrase",
      "could you please let me know", "please let me know what you",
      "not sure i understand", "i'm not sure i follow",
      "what you're looking for", "what are you looking for",
      "i'm sorry, i", "i'm afraid i",
    ];

    while (finalMessage.stop_reason !== "end_turn") {
      turnIndex++;
      console.log(`[chat] ── AI turn ${turnIndex} (stop_reason=${finalMessage.stop_reason}) ──`);
      finalMessage = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          storeKnowledgeSummary,
          tools: [
            ...mcpClient.tools,
            ...faqToolService.getTools(),
            ...productMetafieldsToolService.getTools(),
          ]
        },
        {
          // Handle text chunks
          onText: (textDelta) => {
            stream.sendMessage({
              type: 'chunk',
              chunk: textDelta
            });
          },

          // Handle complete messages
          onMessage: (message) => {
            const toolCalls = Array.isArray(message.content)
              ? message.content.filter(b => b.type === 'tool_use').map(b => b.name)
              : [];
            const textSnippet = Array.isArray(message.content)
              ? message.content.filter(b => b.type === 'text').map(b => b.text).join(' ').slice(0, 200)
              : '';
            console.log(`[chat] AI message: stop_reason=${message.stop_reason}, tool_calls=[${toolCalls.join(', ')}]`);
            if (textSnippet) console.log(`[chat] AI text (first 200 chars): ${textSnippet}`);

            conversationHistory.push({
              role: message.role,
              content: message.content,
            });

            // Capture text for query log analysis
            const textBlocks = Array.isArray(message.content)
              ? message.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
              : typeof message.content === 'string' ? message.content : '';
            if (textBlocks) lastAssistantText = textBlocks;

            lastAssistantSavePromise = saveMessage(conversationId, message.role, JSON.stringify(message.content), shopDomain)
              .catch((error) => {
                console.error("Error saving message to database:", error);
              });

            // Send a completion message
            stream.sendMessage({ type: 'message_complete' });
          },

          // Handle tool use requests
          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;

            const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;

            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });

            // ── Cart mutation guard ────────────────────────────────────────
            // Only products with additional_data.enable_sampling = true may be
            // added to the cart. Block the MCP call and return an error result
            // so the AI informs the customer instead of silently failing.
            if (isCartMutation(toolName)) {
              let variantGids = extractVariantGidsFromCartArgs(toolArgs);

              // Fallback: if cart args didn't yield resolvable GIDs, use the
              // pinned product's GID from the [PINNED_PRODUCT_CONTEXT] block.
              if (variantGids.length === 0) {
                const pinnedGidMatch = userMessage.match(/GID:\s*(gid:\/\/shopify\/Product\/\d+)/);
                if (pinnedGidMatch) variantGids = [pinnedGidMatch[1]];
              }

              if (variantGids.length > 0) {
                const samplingCheck = await toolService.checkSamplingEligibility(variantGids);
                if (!samplingCheck.allowed) {
                  await toolService.addToolResultToHistory(
                    conversationHistory,
                    toolUseId,
                    toolName,
                    `BLOCKED: Samples or purchase of this product are currently unavailable through the chat. Please inform the customer politely that this product or its samples are not available for purchase at this time, and encourage them to reach out to the store directly for assistance. Do not provide any links or contact details.`,
                    conversationId
                  );
                  stream.sendMessage({ type: 'new_message' });
                  return;
                }
              }

              // ── Browser-session cart delegation ───────────────────────────
              // Skip the Storefront MCP entirely for cart mutations. The MCP
              // creates a server-side Storefront API cart (GID) that is NOT the
              // browser session cart the theme tracks via cookie. Instead we
              // send the items to the client which calls /cart/add.js directly.
              const cartItems = extractCartItemsFromArgs(toolArgs);
              stream.sendMessage({ type: 'cart_add_request', items: cartItems });

              // Give the AI a synthetic success result so it can tell the user.
              await toolService.addToolResultToHistory(
                conversationHistory,
                toolUseId,
                toolName,
                JSON.stringify({
                  success: true,
                  message: 'Items have been added to the customer\'s cart.',
                  items: cartItems.map(i => ({ merchandiseId: i.id, quantity: i.quantity })),
                }),
                conversationId
              );
              stream.sendMessage({ type: 'new_message' });
              return;
            }

            // Track catalog tool calls for query logging
            const _catalogNames = AppConfig.tools.catalogToolNames || [AppConfig.tools.productSearchName];
            if (_catalogNames.includes(toolName)) {
              catalogToolCalled = true;
            }

            console.log(`[chat] Tool call: ${toolName} args=${JSON.stringify(toolArgs).slice(0, 300)}`);

            // Call either local FAQ tools or Shopify MCP tools
            const toolUseResponse = faqToolService.canHandle(toolName)
              ? await faqToolService.executeTool(toolName, toolArgs)
              : productMetafieldsToolService.canHandle(toolName)
                ? await productMetafieldsToolService.executeTool(toolName, toolArgs)
                : await mcpClient.callTool(toolName, toolArgs);

            // Handle tool response based on success/error
            // Also handle the { content, isError } shape returned by callTool
            // when a tool is unavailable (graceful fallback, no throw).
            const resultPreview = JSON.stringify(toolUseResponse?.content || toolUseResponse?.error || '').slice(0, 400);
            console.log(`[chat] Tool result for ${toolName}: isError=${!!(toolUseResponse.error||toolUseResponse.isError)} preview=${resultPreview}`);

            if (toolUseResponse.error) {
              hadToolError = true;
              await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
            } else if (toolUseResponse.isError) {
              hadToolError = true;
              // Graceful error shape from callTool / callStorefrontTool
              await toolService.addToolResultToHistory(
                conversationHistory,
                toolUseId,
                toolName,
                toolUseResponse.content,
                conversationId
              );
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                productsToDisplay,
                conversationId
              );
            }

            // Signal new message to client
            stream.sendMessage({ type: 'new_message' });
          },

          // Handle content block completion
          onContentBlock: (contentBlock) => {
            if (contentBlock.type === 'text') {
              stream.sendMessage({
                type: 'content_block_complete',
                content_block: contentBlock
              });
            }
          }
        }
      );
    }

    // Signal end of turn
    stream.sendMessage({ type: 'end_turn' });

    console.log(`[chat] ── End of turn ── lastAssistantText (first 200): ${lastAssistantText.slice(0,200)}`);
    console.log(`[chat] Query-log signals: hadToolError=${hadToolError} catalogToolCalled=${catalogToolCalled} productsFound=${productsToDisplay.length}`);

    // ── Query log: capture every case the AI couldn't fully help ──────────
    if (shopDomain && displayMessage) {
      let logReason = null;

      if (hadToolError) {
        // A tool/MCP call failed outright
        logReason = 'tool_error';
      } else if (catalogToolCalled && productsToDisplay.length === 0) {
        // AI searched the catalog but came back empty-handed
        logReason = 'no_results';
      } else if (lastAssistantText) {
        const lower = lastAssistantText.toLowerCase();
        if (NO_RESULTS_PHRASES.some(p => lower.includes(p))) {
          logReason = 'no_results';
        } else if (OUT_OF_SCOPE_PHRASES.some(p => lower.includes(p))) {
          logReason = 'out_of_scope';
        } else if (UNCERTAIN_PHRASES.some(p => lower.includes(p))) {
          logReason = 'ai_uncertain';
        }
      }

      if (logReason) {
        console.log(`[chat] Query log entry: reason=${logReason} query="${displayMessage.slice(0,100)}"`);
        createQueryLog(shopDomain, {
          query:          displayMessage.slice(0, 1000),
          aiResponse:     lastAssistantText.slice(0, 500),
          reason:         logReason,
          conversationId,
        }).catch(() => {});
      }
    }

    // Send product results and persist them so they reload after a page refresh
    if (productsToDisplay.length > 0) {
      stream.sendMessage({
        type: 'product_results',
        products: productsToDisplay
      });

      // Save to DB as a special assistant message so fetchChatHistory can replay it.
      // Await the last text-message save first so product_results gets a strictly
      // later createdAt — prevents non-deterministic replay order on history load.
      await lastAssistantSavePromise;
      saveMessage(
        conversationId,
        'assistant',
        JSON.stringify({ _chat_type: 'product_results', products: productsToDisplay }),
        shopDomain
      ).catch((err) => console.error('Error persisting product results:', err));
    }
  } catch (error) {
    // The streaming handler takes care of error handling
    throw error;
  }
}

/**
 * Get the customer MCP API URL for a shop
 * @param {string} shopDomain - The shop domain
 * @param {string} conversationId - The conversation ID
 * @returns {string} The customer MCP API URL
 */
async function getCustomerAccountUrls(shopDomain, conversationId) {
  try {
    // Check if the customer account URL exists in the DB
    const existingUrls = await getCustomerAccountUrlsFromDb(conversationId);

    // If URL exists, return early with the MCP API URL
    if (existingUrls) return existingUrls;

    // If not, query for it from the Shopify API
    const hostname = shopDomain.includes('://')
      ? new URL(shopDomain).hostname
      : shopDomain;

    const urls = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`).then(res => res.json()),
      fetch(`https://${hostname}/.well-known/openid-configuration`).then(res => res.json()),
    ]).then(async ([mcpResponse, openidResponse]) => {
      const response = {
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      };

      await storeCustomerAccountUrls({
        conversationId,
        mcpApiUrl: mcpResponse.mcp_api,
        authorizationUrl: openidResponse.authorization_endpoint,
        tokenUrl: openidResponse.token_endpoint,
      });

      return response;
    });

    return urls;
  } catch (error) {
    console.error("Error getting customer MCP API URL:", error);
    return null;
  }
}

/**
 * Gets CORS headers for the response.
 * Validates the Origin against expected Shopify domains before echoing it back
 * with credentials=true. Falls back to the app URL if validation fails.
 * @param {Request} request - The request object
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(request) {
  const requestOrigin = request.headers.get('Origin') || '';

  // Allowed origins: Shopify storefront domains + the app's own host
  const appHost = process.env.SHOPIFY_APP_URL
    ? (() => { try { return new URL(process.env.SHOPIFY_APP_URL).origin; } catch { return ''; } })()
    : '';

  let allowedOrigin;
  try {
    const hostname = requestOrigin ? new URL(requestOrigin).hostname : '';
    const isAllowed =
      hostname.endsWith('.myshopify.com') ||
      hostname.endsWith('.shopify.com') ||
      hostname.endsWith('.shopifypreview.com') ||
      (appHost && requestOrigin === appHost);

    // Only reflect the origin back (with credentials) if it is a known-safe host.
    // For unknown origins, omit credentials and use the app URL as the allowed origin.
    allowedOrigin = isAllowed ? requestOrigin : (appHost || requestOrigin || '*');
  } catch {
    allowedOrigin = appHost || '*';
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Shopify-Shop-Id, X-Shopify-Shop-Domain, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Get SSE headers for the response
 * @param {Request} request - The request object
 * @returns {Object} SSE headers object
 */
function getSseHeaders(request) {
  const cors = getCorsHeaders(request);
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    ...cors
  };
}
