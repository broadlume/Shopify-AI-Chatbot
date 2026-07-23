/**
 * Configuration Service
 * Centralizes all configuration values for the chat service
 */

export const AppConfig = {
  // API Configuration
  api: {
    defaultModel: 'claude-haiku-4-5',
    maxTokens: 2000,
    defaultPromptType: 'standardAssistant',
  },

  // Error Message Templates
  errorMessages: {
    missingMessage: "Message is required",
    apiUnsupported: "This endpoint only supports server-sent events (SSE) requests or history requests.",
    authFailed: "Authentication failed with Anthropic API",
    apiKeyError: "Please check your ANTHROPIC_API_KEY in environment variables",
    rateLimitExceeded: "Rate limit exceeded",
    rateLimitDetails: "Please try again later",
    genericError: "Failed to get response from Claude"
  },

  // Tool Configuration
  tools: {
    // Legacy name kept for reference; use catalogToolNames for all checks
    productSearchName: "search_shop_catalog",
    // All Shopify MCP tool names that return product catalog data
    catalogToolNames: [
      "search_catalog",
      "lookup_catalog",
      "get_product",
      "search_shop_catalog",
    ],
    maxProductsToDisplay: 24
  },

  metafields: {
    fallbackProductNamespaces: (process.env.PRODUCT_ALLOWED_METAFIELD_NAMESPACES || "$app")
      .split(',')
      .map((namespace) => namespace.trim())
      .filter(Boolean),
    fallbackVariantNamespaces: (process.env.VARIANT_ALLOWED_METAFIELD_NAMESPACES || "$app")
      .split(',')
      .map((namespace) => namespace.trim())
      .filter(Boolean),
    defaultVariantLimit: Number(process.env.METAFIELD_VARIANT_LIMIT || 25)
  }
};

export default AppConfig;
