import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    // Allow any hostname so the Cloudflare dev tunnel (whose hostname changes on
    // every `shopify app dev` restart) is never blocked.  The restricted list
    // `[host]` caused Vite to reject tunnel requests before SHOPIFY_APP_URL was
    // fully propagated, producing a connection-drop that Cloudflare surfaced as
    // HTTP 530 in the browser.
    allowedHosts: true,
    // Pre-warm all route modules so the /__manifest fog-of-war endpoint never
    // has to cold-load a module during the first client-side navigation.
    warmup: {
      clientFiles: ['./app/routes/**/*.{jsx,tsx,js,ts}'],
      ssrFiles:    ['./app/routes/**/*.{jsx,tsx,js,ts}'],
    },
    // Fully handle CORS at the Vite dev-server layer so OPTIONS preflights
    // from the storefront origin are answered before React Router routing.
    cors: {
      origin: true,                      // echo back any Origin header
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Accept',
        'X-Shopify-Shop-Id',
        'X-Shopify-Shop-Domain',
        'X-Requested-With',
      ],
      credentials: true,
      maxAge: 86400,
      preflightContinue: false,          // answer OPTIONS here, don't pass through
      optionsSuccessStatus: 204,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // Allow access to all project files so the React Router dev plugin can
      // read routes.js (at the project root) when building the /__manifest
      // response for fog-of-war lazy route discovery.
      // See https://vitejs.dev/config/server-options.html#server-fs-allow
      allow: [".", "app", "node_modules"],
    },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
});
