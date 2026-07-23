import { searchFaqEntries } from "../db.server";

/**
 * Creates FAQ tool service for use in the chat loop.
 * Exposes a local tool that the LLM can call for store-specific FAQs.
 */
export function createFaqToolService({ shopDomain }) {
  const localTools = [
    {
      name: "search_store_faqs",
      description:
        "Search curated store FAQs, custom Q&A, and Shopify KB-derived answers for ANY store-related question. " +
        "Use this as the catch-all fallback whenever other tools return no results or you are unsure of an answer — " +
        "this knowledge base covers store policies, product information, services, promotions, shipping, returns, " +
        "warranties, care instructions, and any merchant-authored Q&A. " +
        "Always call this before telling a customer you don't have information on a topic.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Customer question to match against store FAQs",
          },
          limit: {
            type: "integer",
            description: "Maximum FAQ entries to return",
            minimum: 1,
            maximum: 10,
          },
        },
        required: ["query"],
      },
    },
  ];

  const canHandle = (toolName) => {
    return localTools.some((tool) => tool.name === toolName);
  };

  const executeTool = async (toolName, toolArgs = {}) => {
    if (toolName !== "search_store_faqs") {
      throw new Error(`Unsupported FAQ tool: ${toolName}`);
    }

    const query = String(toolArgs.query || "").trim();
    const limit = Number(toolArgs.limit || 5);

    if (!query) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ faqs: [], message: "Missing search query" }),
          },
        ],
      };
    }

    const matches = await searchFaqEntries(shopDomain, query, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            faqs: matches.map((entry) => ({
              id: entry.id,
              question: entry.question,
              answer: entry.answer,
              tags: entry.tags,
              source: entry.source,
            })),
          }),
        },
      ],
    };
  };

  const getTools = () => localTools;

  return {
    canHandle,
    executeTool,
    getTools,
  };
}

export default {
  createFaqToolService,
};
