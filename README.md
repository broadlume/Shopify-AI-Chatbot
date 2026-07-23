# Build an AI Agent for Your Storefront

A Shopify template app that lets you embed an AI-powered chat widget on your storefront. Shoppers can search for products, ask about policies or shipping, and complete purchases - all without leaving the conversation. Under the hood it speaks the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) to tap into Shopify’s APIs.

## Overview

- **What it is**: A chat widget + backend that turns any storefront into an AI shopping assistant.
- **Key features**:
  - Natural-language product discovery
  - Store policy & FAQ lookup
  - Create carts, add or remove items, and initiate checkout
  - Track orders and initiate returns

## Developer Docs
- Everything from installation to deep dives lives on https://shopify.dev/docs/apps/build/storefront-mcp.
- Clone this repo and follow the instructions on the dev docs.

## Examples
- `hi` > will return a LLM based response. Note that you can customize the LLM call with your own prompt.
- `can you search for snowboards` > will use the `search_shop_catalog` MCP tool.
- `add The Videographer Snowboard to my cart` > will use the `update_cart` MCP tool and offer a checkout URL.
- `update my cart to make that 2 items please` > will use the `update_cart` MCP tool.
- `can you tell me what is in my cart` > will use the `get_cart` MCP tool.
- `what languages is your store available in?` > will use the `search_shop_policies_and_faqs` MCP tool.
- `I'd like to checkout` > will call checkout from one of the above MCP cart tools.
- `Show me my recent orders` > will use the `get_most_recent_order_status` MCP tool.
- `Can you give me more details about order Id 1` > will use the `get_order_status` MCP tool.

## Architecture

### Components
This app consists of two main components:

1. **Backend**: A React Router app server that handles communication with Google AI Studio (Gemini), processes chat messages, and acts as an MCP Client.
2. **Chat UI**: A Shopify theme extension that provides the customer-facing chat interface.

When you start the app, it will:
- Start React Router in development mode.
- Tunnel your local server so Shopify can reach it.
- Provide a preview URL to install the app on your development store.

For direct testing, point your test suite at the `/chat` endpoint (GET or POST for streaming).

### MCP Tools Integration
- The backend already initializes all Shopify MCP tools—see [`app/mcp-client.js`](./app/mcp-client.js).
- These tools let your LLM invoke product search, cart actions, order lookups, etc.
- More in our [dev docs](https://shopify.dev/docs/apps/build/storefront-mcp).

### Tech Stack
- **Framework**: [React Router](https://reactrouter.com/)
- **AI**: [Google AI Studio (Gemini)](https://aistudio.google.com/)
- **Shopify Integration**: [@shopify/shopify-app-react-router](https://www.npmjs.com/package/@shopify/shopify-app-react-router)
- **Database**: SQLite (via Prisma) for session storage

## Customizations
This repo can be customized. You can:
- Edit the prompt
- Change the chat widget UI
- Swap out the LLM
- Manage a store FAQ knowledge base from the embedded app (`/app/faq`)

You can learn how from our [dev docs](https://shopify.dev/docs/apps/build/storefront-mcp).

## Shopify Knowledge Base + FAQ Grounding

This app now includes a built-in FAQ manager so your AI agent can answer store-specific support questions reliably.

- Open the embedded app and go to **FAQ Knowledge**.
- Add FAQs manually, or bulk import a JSON array copied/exported from your Shopify Knowledge Base workflow.
- The assistant uses the `search_store_faqs` tool during chat for policy and support questions.

## Product and Variant Metafields with Namespace Restrictions

The chat backend includes a local tool named `get_product_with_restricted_metafields`.

- It fetches product + variant metafields using Admin GraphQL.
- It enforces separate server-side permission lists for **product metafields** and **variant metafields** from the admin panel: `/app/metafields`.
- You can allow individual metafields by namespace + key for each owner type independently.
- Any requested namespace outside allowed lists is rejected.

Example:

```bash
PRODUCT_ALLOWED_METAFIELD_NAMESPACES=$app,specs
VARIANT_ALLOWED_METAFIELD_NAMESPACES=$app,compliance
METAFIELD_VARIANT_LIMIT=25
```

Fallback env allowlists are used if no admin permissions are configured yet for a given owner type.

Example import format:

```json
[
  {
    "question": "What are your shipping times?",
    "answer": "Orders ship in 1-2 business days and arrive in 3-5 business days.",
    "tags": "shipping, delivery",
    "source": "shopify_kb"
  },
  {
    "question": "What is your return policy?",
    "answer": "You can return unused items within 30 days of delivery.",
    "tags": "returns"
  }
]
```

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and add your `GOOGLE_API_KEY`.

3. Apply database migrations:

```bash
npm run setup
```

4. Start dev server:

```bash
shopify app dev --use-localhost --reset
```

5. Enable the theme app embed for the `chat-bubble` extension in Online Store > Themes > Customize.

## Deployment
Follow standard Shopify app deployment procedures as outlined in the [Shopify documentation](https://shopify.dev/docs/apps/deployment/web).

## Contributing
We appreciate your interest in contributing to this project. As this is an example repository intended for educational and reference purposes, we are not accepting contributions.
