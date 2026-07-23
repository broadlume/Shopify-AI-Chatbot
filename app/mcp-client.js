import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";

/**
 * Client for interacting with Model Context Protocol (MCP) API endpoints.
 * Manages connections to both customer and storefront MCP endpoints, and handles tool invocation.
 */
class MCPClient {
  /**
   * Creates a new MCPClient instance.
   *
   * @param {string} hostUrl - The base URL for the shop
   * @param {string} conversationId - ID for the current conversation
   * @param {string} shopId - ID of the Shopify shop
   */
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.tools = [];
    this.customerTools = [];
    this.storefrontTools = [];

    // Standard Storefront MCP — cart, policies, FAQs
    this.storefrontMcpEndpoint = `${hostUrl}/api/mcp`;

    // UCP catalog MCP — search_catalog, lookup_catalog, get_product
    // These MUST use /api/ucp/mcp and require a different argument format
    this.ucpMcpEndpoint = `${hostUrl}/api/ucp/mcp`;

    // Agent profile required by every UCP catalog request
    this.ucpAgentProfile =
      'https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json';

    // Tool names that belong to the UCP catalog endpoint
    this.ucpCatalogToolNames = new Set([
      'search_catalog',
      'lookup_catalog',
      'get_product',
    ]);

    const accountHostUrl = hostUrl.replace(/(\.)myshopify(\.com)$/, '.account$1myshopify$2');
    this.customerMcpEndpoint = customerMcpEndpoint || `${accountHostUrl}/customer/api/mcp`;
    this.customerAccessToken = '';
    this.conversationId = conversationId;
    this.shopId = shopId;
  }

  /**
   * Connects to the customer MCP server and retrieves available tools.
   * Attempts to use an existing token or will proceed without authentication.
   *
   * @returns {Promise<Array>} Array of available customer tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToCustomerServer() {
    try {
      console.log(`Connecting to MCP server at ${this.customerMcpEndpoint}`);

      if (this.conversationId) {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      // If we still don't have a token, we'll connect without one
      // and tools that require auth will prompt for it later
      const headers = {
        "Content-Type": "application/json",
        "Authorization": this.customerAccessToken || ""
      };

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const customerTools = this._formatToolsData(toolsData);

      this.customerTools = customerTools;
      this.tools = [...this.tools, ...customerTools];

      return customerTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Connects to the storefront MCP server and retrieves available tools.
   *
   * @returns {Promise<Array>} Array of available storefront tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToStorefrontServer() {
    try {
      const headers = { 'Content-Type': 'application/json' };

      // List tools from both the standard and UCP catalog endpoints
      const [standardResp, ucpResp] = await Promise.allSettled([
        this._makeJsonRpcRequest(this.storefrontMcpEndpoint, 'tools/list', {}, headers),
        this._makeJsonRpcRequest(this.ucpMcpEndpoint,        'tools/list', {}, headers),
      ]);

      const standardTools = standardResp.status === 'fulfilled'
        ? this._formatToolsData(standardResp.value?.result?.tools || [])
        : [];

      const ucpTools = ucpResp.status === 'fulfilled'
        ? this._formatToolsData(ucpResp.value?.result?.tools || [])
        : [];

      const storefrontTools = [...standardTools, ...ucpTools];
      this.storefrontTools = storefrontTools;
      this.tools = [...this.tools, ...storefrontTools];

      console.log(`Storefront: ${standardTools.length} standard tools, ${ucpTools.length} UCP catalog tools`);
      return storefrontTools;
    } catch (e) {
      console.error('Failed to connect to storefront MCP:', e);
      throw e;
    }
  }

  /**
   * Dispatches a tool call to the appropriate MCP server based on the tool name.
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If tool is not found or call fails
   */
  async callTool(toolName, toolArgs) {
    if (this.customerTools.some(tool => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some(tool => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else if (this.ucpCatalogToolNames.has(toolName)) {
      // UCP catalog tools may not be in storefrontTools if the tools/list call
      // failed at connection time, but callStorefrontTool already has a fallback
      // to the standard endpoint — route there instead of throwing.
      console.warn(`[MCP] Tool ${toolName} not in storefrontTools cache; routing directly to callStorefrontTool`);
      return this.callStorefrontTool(toolName, toolArgs);
    } else {
      // Unknown tool — return a graceful error result so the stream does not crash.
      // The AI will receive this as a tool result and can inform the user.
      console.error(`[MCP] Tool "${toolName}" not found. customerTools=[${this.customerTools.map(t => t.name).join(',')}] storefrontTools=[${this.storefrontTools.map(t => t.name).join(',')}]`);
      return {
        content: [{ type: 'text', text: `Tool "${toolName}" is not available in this session.` }],
        isError: true,
      };
    }
  }

  /**
   * Calls a tool on the storefront MCP server.
   *
   * @param {string} toolName - Name of the storefront tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If the tool call fails
   */
  async callStorefrontTool(toolName, toolArgs) {
    try {
      const headers = { 'Content-Type': 'application/json' };

      if (this.ucpCatalogToolNames.has(toolName)) {
        // UCP catalog tools: try /api/ucp/mcp first with proper argument wrapping
        const rawCatalog = toolArgs.catalog || toolArgs;
        // Ensure the AI always requests enough results; the AI may default to 10.
        const rawWithCount = { count: 24, ...rawCatalog };
        const ucpArgs = {
          meta: { 'ucp-agent': { profile: this.ucpAgentProfile } },
          catalog: rawWithCount,
        };

        try {
          console.log(`Calling UCP catalog tool: ${toolName}`, rawWithCount);
          const response = await this._makeJsonRpcRequest(
            this.ucpMcpEndpoint,
            'tools/call',
            { name: toolName, arguments: ucpArgs },
            headers,
          );
          return response.result || response;
        } catch (ucpError) {
          // UCP endpoint unavailable for this store — fall back to standard endpoint
          console.warn(
            `UCP endpoint failed for ${toolName} (${ucpError.message.slice(0, 120)}), falling back to standard endpoint`
          );
          try {
            const fallback = await this._makeJsonRpcRequest(
              this.storefrontMcpEndpoint,
              'tools/call',
              { name: toolName, arguments: { count: 24, ...toolArgs } },
              headers,
            );
            return fallback.result || fallback;
          } catch (fallbackError) {
            console.error(`Both UCP and standard endpoints failed for ${toolName}:`, fallbackError.message);
            return {
              content: [{ type: 'text', text: `The product catalog tool "${toolName}" is currently unavailable. Please try again later.` }],
              isError: true,
            };
          }
        }
      }

      // Standard tools — pass args through unchanged
      console.log(`Calling storefront tool: ${toolName}`, toolArgs);
      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        'tools/call',
        { name: toolName, arguments: toolArgs },
        headers,
      );
      return response.result || response;
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      return {
        content: [{ type: 'text', text: `Tool "${toolName}" encountered an error: ${error.message}` }],
        isError: true,
      };
    }
  }

  /**
   * Calls a tool on the customer MCP server.
   * Handles authentication if needed.
   *
   * @param {string} toolName - Name of the customer tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call or auth error
   * @throws {Error} If the tool call fails
   */
  async callCustomerTool(toolName, toolArgs) {
    try {
      console.log("Calling customer tool", toolName, toolArgs);
      // First try to get a token from the database for this conversation
      let accessToken = this.customerAccessToken;

      if (!accessToken || accessToken === "") {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          accessToken = dbToken.accessToken;
          this.customerAccessToken = accessToken; // Store it for later use
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": accessToken
      };

      try {
        const response = await this._makeJsonRpcRequest(
          this.customerMcpEndpoint,
          "tools/call",
          {
            name: toolName,
            arguments: toolArgs,
          },
          headers
        );

        return response.result || response;
      } catch (error) {
        // Handle 401 specifically to trigger authentication
        if (error.status === 401) {
          console.log("Unauthorized, generating authorization URL for customer");

          // Generate auth URL
          const authResponse = await generateAuthUrl(this.conversationId, this.shopId);

          // Instead of retrying, return the auth URL for the front-end
          return {
            error: {
              type: "auth_required",
              data: `You need to authorize the app to access your customer data. [Click here to authorize](${authResponse.url})`
            }
          };
        }

        // Re-throw other errors
        throw error;
      }
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      return {
        error: {
          type: "internal_error",
          data: `Error calling tool ${toolName}: ${error.message}`
        }
      };
    }
  }

  /**
   * Makes a JSON-RPC request to the specified endpoint.
   *
   * @private
   * @param {string} endpoint - The endpoint URL
   * @param {string} method - The JSON-RPC method to call
   * @param {Object} params - Parameters for the method
   * @param {Object} headers - HTTP headers for the request
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} If the request fails
   */
  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: method,
        id: 1,
        params: params,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const preview = body.slice(0, 300).replace(/\s+/g, ' ');
      const err = new Error(`Request failed: ${response.status} ${preview}`);
      err.status = response.status;
      throw err;
    }

    // Detect HTML responses (e.g. login redirects returning 200 with an HTML page)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const body = await response.text();
      const preview = body.slice(0, 200).replace(/\s+/g, ' ');
      const err = new Error(`Endpoint ${endpoint} returned HTML instead of JSON: ${preview}`);
      err.status = response.status;
      throw err;
    }

    return await response.json();
  }

  /**
   * Formats raw tool data into a consistent format.
   *
   * @private
   * @param {Array} toolsData - Raw tools data from the API
   * @returns {Array} Formatted tools data
   */
  _formatToolsData(toolsData) {
    return toolsData.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema || tool.input_schema,
      };
    });
  }
}

export default MCPClient;
