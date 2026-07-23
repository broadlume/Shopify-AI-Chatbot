import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;

/**
 * Store a code verifier for PKCE authentication
 * @param {string} state - The state parameter used in OAuth flow
 * @param {string} verifier - The code verifier to store
 * @returns {Promise<Object>} - The saved code verifier object
 */
export async function storeCodeVerifier(state, verifier) {
  // Calculate expiration date (10 minutes from now)
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

  try {
    return await prisma.codeVerifier.create({
      data: {
        id: `cv_${Date.now()}`,
        state,
        verifier,
        expiresAt
      }
    });
  } catch (error) {
    console.error('Error storing code verifier:', error);
    throw error;
  }
}

/**
 * Get a code verifier by state parameter
 * @param {string} state - The state parameter used in OAuth flow
 * @returns {Promise<Object|null>} - The code verifier object or null if not found
 */
export async function getCodeVerifier(state) {
  try {
    const verifier = await prisma.codeVerifier.findFirst({
      where: {
        state,
        expiresAt: {
          gt: new Date()
        }
      }
    });

    if (verifier) {
      // Delete it after retrieval to prevent reuse
      await prisma.codeVerifier.delete({
        where: {
          id: verifier.id
        }
      });
    }

    return verifier;
  } catch (error) {
    console.error('Error retrieving code verifier:', error);
    return null;
  }
}

/**
 * Store a customer access token in the database
 * @param {string} conversationId - The conversation ID to associate with the token
 * @param {string} accessToken - The access token to store
 * @param {Date} expiresAt - When the token expires
 * @returns {Promise<Object>} - The saved customer token
 */
export async function storeCustomerToken(conversationId, accessToken, expiresAt) {
  try {
    // Check if a token already exists for this conversation
    const existingToken = await prisma.customerToken.findFirst({
      where: { conversationId }
    });

    if (existingToken) {
      // Update existing token
      return await prisma.customerToken.update({
        where: { id: existingToken.id },
        data: {
          accessToken,
          expiresAt,
          updatedAt: new Date()
        }
      });
    }

    // Create a new token record
    return await prisma.customerToken.create({
      data: {
        id: `ct_${Date.now()}`,
        conversationId,
        accessToken,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error storing customer token:', error);
    throw error;
  }
}

/**
 * Get a customer access token by conversation ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>} - The customer token or null if not found/expired
 */
export async function getCustomerToken(conversationId) {
  try {
    const token = await prisma.customerToken.findFirst({
      where: {
        conversationId,
        expiresAt: {
          gt: new Date() // Only return non-expired tokens
        }
      }
    });

    return token;
  } catch (error) {
    console.error('Error retrieving customer token:', error);
    return null;
  }
}

/**
 * Create or update a conversation in the database
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} - The created or updated conversation
 */
export async function createOrUpdateConversation(conversationId) {
  try {
    const existingConversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (existingConversation) {
      return await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date()
        }
      });
    }

    return await prisma.conversation.create({
      data: {
        id: conversationId
      }
    });
  } catch (error) {
    console.error('Error creating/updating conversation:', error);
    throw error;
  }
}

/**
 * Save a message to the database
 * @param {string} conversationId - The conversation ID
 * @param {string} role - The message role (user or assistant)
 * @param {string} content - The message content
 * @returns {Promise<Object>} - The saved message
 */
export async function saveMessage(conversationId, role, content) {
  try {
    // Ensure the conversation exists
    await createOrUpdateConversation(conversationId);

    // Create the message
    return await prisma.message.create({
      data: {
        conversationId,
        role,
        content
      }
    });
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

/**
 * Get conversation history
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Array>} - Array of messages in the conversation
 */
export async function getConversationHistory(conversationId) {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' }
    });

    return messages;
  } catch (error) {
    console.error('Error retrieving conversation history:', error);
    return [];
  }
}

/**
 * Store customer account URLs for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {string} mcpApiUrl - The customer account MCP URL
 * @param {string} authorizationUrl - The customer account authorization URL
 * @param {string} tokenUrl - The customer account token URL
 * @returns {Promise<Object>} - The saved urls object
 */
export async function storeCustomerAccountUrls({conversationId, mcpApiUrl, authorizationUrl, tokenUrl}) {
  try {
    return await prisma.customerAccountUrls.upsert({
      where: { conversationId },
      create: {
        conversationId,
        mcpApiUrl,
        authorizationUrl,
        tokenUrl,
        updatedAt: new Date(),
      },
      update: {
        mcpApiUrl,
        authorizationUrl,
        tokenUrl,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error storing customer account URLs:', error);
    throw error;
  }
}

/**
 * Get customer account URLs for a conversation
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>} - The customer account URLs or null if not found
 */
export async function getCustomerAccountUrls(conversationId) {
  try {
    return await prisma.customerAccountUrls.findUnique({
      where: { conversationId }
    });
  } catch (error) {
    console.error('Error retrieving customer account URLs:', error);
    return null;
  }
}

/**
 * Get offline admin access token for a shop
 * @param {string} shopDomain - Shop domain in myshopify format
 * @returns {Promise<string|null>} - Access token or null
 */
export async function getOfflineAccessTokenByShop(shopDomain) {
  try {
    if (!shopDomain) return null;

    const session = await prisma.session.findFirst({
      where: {
        shop: shopDomain,
        isOnline: false,
      },
      orderBy: {
        expires: 'desc',
      },
    });

    return session?.accessToken || null;
  } catch (error) {
    console.error('Error retrieving offline access token:', error);
    return null;
  }
}

/**
 * List FAQ entries for a given shop
 * @param {string} shopDomain - Shop domain
 * @param {Object} options - Query options
 * @param {boolean} options.publishedOnly - If true, only return published FAQs
 * @returns {Promise<Array>} - FAQ entries
 */
export async function listFaqEntries(shopDomain, { publishedOnly = false } = {}) {
  try {
    return await prisma.faqEntry.findMany({
      where: {
        shopDomain,
        ...(publishedOnly ? { published: true } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  } catch (error) {
    console.error('Error listing FAQ entries:', error);
    return [];
  }
}

/**
 * Create a new FAQ entry
 * @param {Object} payload - FAQ data
 * @returns {Promise<Object>} - Created FAQ entry
 */
export async function createFaqEntry(payload) {
  try {
    return await prisma.faqEntry.create({
      data: payload,
    });
  } catch (error) {
    console.error('Error creating FAQ entry:', error);
    throw error;
  }
}

/**
 * Update an existing FAQ entry
 * @param {string} id - FAQ ID
 * @param {Object} payload - FAQ fields
 * @returns {Promise<Object>} - Updated FAQ entry
 */
export async function updateFaqEntry(id, payload) {
  try {
    return await prisma.faqEntry.update({
      where: { id },
      data: payload,
    });
  } catch (error) {
    console.error('Error updating FAQ entry:', error);
    throw error;
  }
}

/**
 * Delete a FAQ entry
 * @param {string} id - FAQ ID
 * @returns {Promise<Object>} - Deleted FAQ entry
 */
export async function deleteFaqEntry(id) {
  try {
    return await prisma.faqEntry.delete({
      where: { id },
    });
  } catch (error) {
    console.error('Error deleting FAQ entry:', error);
    throw error;
  }
}

/**
 * Bulk upsert FAQ entries for a shop
 * @param {string} shopDomain - Shop domain
 * @param {Array} entries - FAQ entries in {question, answer, tags, source, published}
 * @returns {Promise<number>} - Number of created entries
 */
export async function bulkCreateFaqEntries(shopDomain, entries) {
  try {
    const sanitizedEntries = entries
      .filter((entry) => entry?.question && entry?.answer)
      .map((entry) => ({
        shopDomain,
        question: String(entry.question).trim(),
        answer: String(entry.answer).trim(),
        tags: entry.tags ? String(entry.tags).trim() : null,
        source: entry.source ? String(entry.source).trim() : 'shopify_kb',
        published: typeof entry.published === 'boolean' ? entry.published : true,
      }));

    if (sanitizedEntries.length === 0) return 0;

    const result = await prisma.faqEntry.createMany({
      data: sanitizedEntries,
    });

    return result.count;
  } catch (error) {
    console.error('Error bulk creating FAQ entries:', error);
    throw error;
  }
}

/**
 * Search FAQ entries using simple keyword scoring
 * @param {string} shopDomain - Shop domain
 * @param {string} query - User question
 * @param {number} limit - Max entries to return
 * @returns {Promise<Array>} - Matching FAQs
 */
export async function searchFaqEntries(shopDomain, query, limit = 5) {
  const normalizedQuery = String(query || '').toLowerCase().trim();
  if (!normalizedQuery) return [];

  const tokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/gi, ''))
    .filter(Boolean);

  if (tokens.length === 0) return [];

  try {
    const entries = await prisma.faqEntry.findMany({
      where: {
        shopDomain,
        published: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    const scored = entries
      .map((entry) => {
        const haystack = `${entry.question} ${entry.answer} ${entry.tags || ''}`.toLowerCase();
        const score = tokens.reduce((total, token) => {
          if (!haystack.includes(token)) return total;
          if (entry.question.toLowerCase().includes(token)) return total + 3;
          if ((entry.tags || '').toLowerCase().includes(token)) return total + 2;
          return total + 1;
        }, 0);

        return { ...entry, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.updatedAt) - Number(a.updatedAt))
      .slice(0, Math.max(1, Math.min(limit, 10)));

    return scored;
  } catch (error) {
    console.error('Error searching FAQ entries:', error);
    return [];
  }
}

/**
 * List metafield permissions for a shop
 * @param {string} shopDomain - Shop domain
 * @returns {Promise<Array>} - Permission rows
 */
export async function listMetafieldPermissions(shopDomain) {
  try {
    return await prisma.metafieldPermission.findMany({
      where: { shopDomain },
      orderBy: [
        { ownerType: 'asc' },
        { namespace: 'asc' },
        { key: 'asc' },
      ],
    });
  } catch (error) {
    console.error('Error listing metafield permissions:', error);
    return [];
  }
}

/**
 * Create or enable a metafield permission
 * @param {Object} payload - Permission fields
 * @returns {Promise<Object>} - Upserted permission
 */
export async function upsertMetafieldPermission(payload) {
  try {
    const { shopDomain, ownerType, namespace, key } = payload;

    return await prisma.metafieldPermission.upsert({
      where: {
        shopDomain_ownerType_namespace_key: {
          shopDomain,
          ownerType,
          namespace,
          key,
        },
      },
      create: {
        shopDomain,
        ownerType,
        namespace,
        key,
        enabled: true,
      },
      update: {
        enabled: true,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error upserting metafield permission:', error);
    throw error;
  }
}

/**
 * Toggle metafield permission enabled state
 * @param {string} id - Permission ID
 * @param {boolean} enabled - Enabled flag
 * @returns {Promise<Object>} - Updated permission
 */
export async function updateMetafieldPermission(id, enabled) {
  try {
    return await prisma.metafieldPermission.update({
      where: { id },
      data: {
        enabled,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error updating metafield permission:', error);
    throw error;
  }
}

/**
 * Delete metafield permission row
 * @param {string} id - Permission ID
 * @returns {Promise<Object>} - Deleted permission
 */
export async function deleteMetafieldPermission(id) {
  try {
    return await prisma.metafieldPermission.delete({
      where: { id },
    });
  } catch (error) {
    console.error('Error deleting metafield permission:', error);
    throw error;
  }
}

/**
 * Get enabled metafield permissions split by owner type
 * @param {string} shopDomain - Shop domain
 * @returns {Promise<{product: Array, variant: Array}>} - Owner type buckets
 */
export async function getEnabledMetafieldPermissions(shopDomain) {
  try {
    const rows = await prisma.metafieldPermission.findMany({
      where: {
        shopDomain,
        enabled: true,
      },
      orderBy: [
        { ownerType: 'asc' },
        { namespace: 'asc' },
        { key: 'asc' },
      ],
    });

    return {
      product: rows.filter((row) => row.ownerType === 'PRODUCT'),
      variant: rows.filter((row) => row.ownerType === 'VARIANT'),
    };
  } catch (error) {
    console.error('Error getting enabled metafield permissions:', error);
    return { product: [], variant: [] };
  }
}

// ── Query Log helpers ──────────────────────────────────────────────────────

export async function createQueryLog(shopDomain, { query, aiResponse, reason, conversationId }) {
  try {
    return await prisma.queryLog.create({
      data: { shopDomain, query: query?.slice(0, 2000) ?? '', aiResponse: aiResponse?.slice(0, 500), reason, conversationId },
    });
  } catch (err) {
    console.error('Error creating query log:', err);
  }
}

export async function listQueryLogs(shopDomain, { limit = 100, offset = 0 } = {}) {
  try {
    const [items, total] = await Promise.all([
      prisma.queryLog.findMany({
        where: { shopDomain },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.queryLog.count({ where: { shopDomain } }),
    ]);
    return { items, total };
  } catch (err) {
    console.error('Error listing query logs:', err);
    return { items: [], total: 0 };
  }
}

export async function deleteQueryLog(id) {
  try { return await prisma.queryLog.delete({ where: { id } }); } catch {}
}

// ── SyncStatus helpers ─────────────────────────────────────────────────────

export async function getSyncStatus(shopDomain) {
  try {
    return await prisma.syncStatus.findUnique({ where: { shopDomain } });
  } catch { return null; }
}

export async function listSyncLogs(shopDomain, { limit = 50 } = {}) {
  try {
    return await prisma.syncLog.findMany({
      where: { shopDomain },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  } catch { return []; }
}

// ── ShopConfig helpers ─────────────────────────────────────────────────────

export async function getShopConfig(shopDomain) {
  try {
    return await prisma.shopConfig.findUnique({ where: { shopDomain } });
  } catch { return null; }
}

export async function upsertShopConfig(shopDomain, data) {
  return prisma.shopConfig.upsert({
    where: { shopDomain },
    create: { shopDomain, ...data },
    update: data,
  });
}
