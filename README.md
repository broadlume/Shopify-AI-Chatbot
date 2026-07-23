# Shopify AI Chatbot App

Embedded Shopify app plus theme extension that adds an AI shopping assistant to a storefront.

The app combines:

- A React Router admin app for configuration and operations.
- A theme app extension (`chat-bubble`) for storefront chat UI.
- A chat backend that streams responses from Anthropic Claude and invokes Shopify MCP tools.

## Minimum Env Vars (Quick Start)

For first local run, these are the minimum values you should define in `.env`:

```bash
ANTHROPIC_API_KEY=<your_anthropic_api_key>
SHOPIFY_API_KEY=<your_shopify_app_client_id>
SHOPIFY_API_SECRET=<your_shopify_app_client_secret>
SHOPIFY_APP_URL=<your_tunnel_or_local_url>
SCOPES=unauthenticated_read_product_listings,read_products,read_content,read_product_listings
DATABASE_URL=file:./dev.sqlite
```

You can start from `.env.example` and then customize optional values such as `ANTHROPIC_MODEL`, `REDIRECT_URL`, and metafield fallback settings.

## Features

- AI chat endpoint with SSE streaming (`/chat`) and conversation history persistence.
- MCP tool orchestration across:
  - Storefront tools (catalog, cart, policies/FAQs)
  - Customer account tools (orders/account-specific actions)
  - UCP catalog tools (`search_catalog`, `lookup_catalog`, `get_product`) with fallback behavior
- Store knowledge sync (products, collections, pages, blogs, tags, specs) with:
  - Automatic background refresh
  - Manual sync + sync progress UI
  - Sync run history/logs
- FAQ knowledge management:
  - Create/edit/delete/publish FAQs
  - Bulk import FAQs from JSON/CSV-friendly flows
  - Query log to capture unresolved user questions and convert them to FAQs
- Product/variant metafield access controls:
  - Separate allowlists for `PRODUCT` and `VARIANT`
  - Per-namespace + key permissions managed in admin
  - Environment fallback allowlists when admin permissions are not configured yet
- Preset configuration UI for welcome screen chips/cards and quick actions.
- Per-shop chatbot settings (welcome message, bubble color, prompt style) that override theme defaults.

## Project Structure

- `app/`: Embedded admin app + chat API routes + backend services.
- `extensions/chat-bubble/`: Shopify theme extension for storefront chat bubble/widget.
- `prisma/`: SQLite schema and migrations for sessions, conversations, FAQs, logs, and config.
- `shopify.app.toml` / `shopify.app.chatbot.toml`: Shopify app CLI configuration.

## Tech Stack

- React Router 7
- Shopify App React Router SDK + Polaris
- Anthropic Messages API (Claude, streaming)
- Prisma + SQLite
- Shopify Theme App Extension

## Prerequisites

- Node.js `>= 20.10`
- npm
- Shopify CLI
- A Shopify Partner account and a development store
- Anthropic API key

## Local Development Setup

1. Install dependencies.

```bash
npm install
```

2. Create your local environment file.

```bash
cp .env.example .env
```

3. Update `.env` values (minimum required values below).

```bash
# Required for AI responses
ANTHROPIC_API_KEY=<your_anthropic_api_key>

# Optional Claude model override (default from config.server.js)
ANTHROPIC_MODEL=claude-haiku-4-5

# Shopify values are typically set/managed by Shopify CLI during app dev,
# but you can define them explicitly when needed:
SHOPIFY_API_KEY=<your_shopify_app_client_id>
SHOPIFY_API_SECRET=<your_shopify_app_client_secret>
SHOPIFY_APP_URL=<your_tunnel_or_local_url>
SCOPES=unauthenticated_read_product_listings,read_products,read_content,read_product_listings
REDIRECT_URL=https://localhost:3458/auth/callback

# Optional metafield fallback settings
PRODUCT_ALLOWED_METAFIELD_NAMESPACES=$app,specs
VARIANT_ALLOWED_METAFIELD_NAMESPACES=$app,compliance
METAFIELD_VARIANT_LIMIT=25
```

4. Initialize database and Prisma client.

```bash
npm run setup
```

5. Start local development.

```bash
npm run dev
```

Notes:

- `npm run dev` runs `shopify app dev`.
- For first-time scope/config refreshes you may use:

```bash
shopify app dev --use-localhost --reset
```

- Enable the theme app embed for `chat-bubble` in:
  Online Store -> Themes -> Customize -> App embeds.

## App Management and Configuration

After installing the app in your dev store, open the embedded admin app and manage it from these sections:

- `FAQ Knowledge`: maintain grounded Q&A entries, publish/hide items, bulk import.
- `Metafield Access`: define allowed product/variant metafields exposed to AI answers.
- `Sync Information`: trigger manual knowledge sync and review status/history.
- `Query Log`: inspect unanswered customer prompts and convert them into FAQs.
- `Preset Configuration`: configure welcome cards, suggestion chips, and quick action chips.
- `Settings`: configure bubble color, welcome text, and prompt style.

## Useful Scripts

- `npm run dev`: run Shopify app in development mode.
- `npm run build`: production build.
- `npm run start`: serve built app.
- `npm run setup`: Prisma generate + migrate deploy.
- `npm run lint`: run ESLint.
- `npm run typecheck`: generate route types and run TypeScript checks.
- `npm run deploy`: deploy app with Shopify CLI.
- `npm run config:link`, `npm run config:use`, `npm run env`: Shopify CLI config/environment helpers.

## Operational Notes

- Data persistence uses SQLite via Prisma (`DATABASE_URL`).
- Chat conversations and tool traces rely on per-conversation IDs managed server-side.
- The project uses Anthropic Claude in backend services.

## Troubleshooting

- If app scopes change in `shopify.app.toml`, re-run development with reset/reinstall flow so token scopes are refreshed.
- If chat loads but returns AI errors, verify `ANTHROPIC_API_KEY` and model name.
- If storefront widget does not appear, verify the app embed is enabled in the current theme and the app backend URL is configured.
- If Prisma-related startup fails, run `npm run setup` again and verify `DATABASE_URL`.

## Reference

- Shopify MCP storefront app docs: https://shopify.dev/docs/apps/build/storefront-mcp
- Shopify app deployment docs: https://shopify.dev/docs/apps/deployment/web
