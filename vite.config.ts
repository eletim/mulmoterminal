import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { normalizeBasePath, basePathPrefix } from "./common/basePath.ts";

// Dev ports. The backend (Express) listens on PORT (default 34567, see
// server/index.ts); Vite's own dev server uses CLIENT_PORT — a SEPARATE port, since
// both run at once under `yarn dev` and can't share one. Both are env-overridable.
const BACKEND_PORT = process.env.PORT || "34567";
const CLIENT_PORT = Number(process.env.CLIENT_PORT) || 6856;
const BASE_PATH = normalizeBasePath(process.env.MULMOTERMINAL_BASE_PATH);
const BASE_PREFIX = basePathPrefix(BASE_PATH);

function backendProxy(target: string, ws = false) {
  return {
    target,
    ...(ws ? { ws: true } : {}),
    changeOrigin: !ws,
  };
}

const proxy = {
  // socket.io pub/sub (sidebar activity). Must precede the "/ws" rule.
  "/ws/pubsub": backendProxy(`ws://localhost:${BACKEND_PORT}`, true),
  "/ws": backendProxy(`ws://localhost:${BACKEND_PORT}`, true),
  "/api": backendProxy(`http://localhost:${BACKEND_PORT}`),
  // presentHtml page serving (the View's iframe src). Without this, the dev
  // Vite catch-all returns index.html instead of the HTML artifact.
  "/artifacts": backendProxy(`http://localhost:${BACKEND_PORT}`),
  "/htmlfile": backendProxy(`http://localhost:${BACKEND_PORT}`),
  ...(BASE_PREFIX
    ? {
        [`${BASE_PREFIX}/ws/pubsub`]: backendProxy(`ws://localhost:${BACKEND_PORT}`, true),
        [`${BASE_PREFIX}/ws`]: backendProxy(`ws://localhost:${BACKEND_PORT}`, true),
        [`${BASE_PREFIX}/api`]: backendProxy(`http://localhost:${BACKEND_PORT}`),
        [`${BASE_PREFIX}/artifacts`]: backendProxy(`http://localhost:${BACKEND_PORT}`),
        [`${BASE_PREFIX}/htmlfile`]: backendProxy(`http://localhost:${BACKEND_PORT}`),
      }
    : {}),
};

export default defineConfig({
  base: BASE_PATH,
  // Tailwind is used ONLY to compile the plugin-utilities sheet
  // (src/plugin-tailwind.css), which GuiPanel injects into the per-plugin Shadow
  // DOM. MulmoTerminal's own UI is not Tailwind; nothing here imports the sheet as
  // a global side-effect, so the app's styles are untouched.
  plugins: [vue(), tailwindcss()],
  // vue-i18n (pulled in by accounting/collection plugin Views) breaks Vite's esbuild
  // dep pre-bundling: the optimized vue-i18n chunk calls Vue runtime init wrappers
  // (init_runtime_dom_esm_bundler / init_shared_esm_bundler) it never imports across
  // the chunk boundary -> "ReferenceError: init_runtime_dom_esm_bundler is not
  // defined" at runtime. Exclude it from pre-bundling so it's served as ESM source
  // (no esbuild split), and define the @intlify compile-time feature flags the
  // esm-bundler build expects (Vite's vue plugin only defines the __VUE_*__ flags).
  optimizeDeps: { exclude: ["vue-i18n"] },
  define: {
    __VUE_I18N_FULL_INSTALL__: "true",
    __VUE_I18N_LEGACY_API__: "false",
    __INTLIFY_JIT_COMPILATION__: "false",
    __INTLIFY_DROP_MESSAGE_COMPILER__: "false",
    __INTLIFY_PROD_DEVTOOLS__: "false",
  },
  server: {
    port: CLIENT_PORT,
    // Disable Vite's dev CORS middleware. The app is same-origin in dev (the page
    // and the proxied `/api` both live on the Vite dev port), so it needs no CORS headers from
    // Vite. The one cross-origin consumer is a custom collection view: it renders in
    // a sandboxed (opaque-origin) iframe whose fetch to
    // `/api/collections/:slug/view-data` is cross-origin and preflighted. With Vite's
    // CORS enabled, Vite answers that OPTIONS itself WITHOUT an
    // `Access-Control-Allow-Origin` (it rejects the "null" origin) and the preflight
    // fails before reaching the backend. Disabling it lets the preflight (and the
    // request) flow through the proxy to Express, which sets the correct CORS headers
    // (viewDataCors in server/backends/collections.ts). Production has no Vite proxy
    // — the iframe hits Express directly — so this is dev-only. Matches MulmoClaude.
    cors: false,
    proxy,
  },
});
