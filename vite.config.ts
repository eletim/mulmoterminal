import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { normalizeBasePath, basePathPrefix } from "./common/basePath.ts";

// Dev ports. The backend (Express) listens on PORT (default 34567, see
// server/index.ts); Vite's own dev server uses CLIENT_PORT — a SEPARATE port, since
// both run at once under `yarn dev` and can't share one. Both are env-overridable.
const BACKEND_PORT = process.env.PORT || "34567";
const CLIENT_PORT = Number(process.env.CLIENT_PORT) || 6856;
const VITE_HOST = process.env.MULMOTERMINAL_VITE_HOST;
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
  server: {
    port: CLIENT_PORT,
    ...(VITE_HOST ? { host: VITE_HOST } : {}),
    // Disable Vite's dev CORS middleware. The app is same-origin in dev (the page
    // and the proxied `/api` both live on the Vite dev port), so it needs no CORS headers from
    // Vite; cross-origin policy is owned by the backend guard.
    cors: false,
    proxy,
  },
});
