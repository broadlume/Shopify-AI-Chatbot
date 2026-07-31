import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// ── Startup environment validation ────────────────────────────────────────────
// Fail fast with a clear message rather than letting the app silently misbehave.
// These checks run once at module load time (server startup).
const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
];

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `[startup] Missing required environment variables: ${missing.join(", ")}\n` +
    `Copy .env.example to .env and fill in all values before starting the server.`
  );
}

// Warn (not throw) for SCOPES and REDIRECT_URL since they have defaults/fallbacks
if (!process.env.SCOPES) {
  console.warn(
    "[startup] SCOPES env var is not set. Falling back to shopify.app.toml scopes. " +
    "Set SCOPES=unauthenticated_read_product_listings,read_products,read_content,read_product_listings"
  );
}
if (!process.env.REDIRECT_URL) {
  console.warn(
    "[startup] REDIRECT_URL env var is not set. Customer OAuth PKCE flow will fail in production."
  );
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
