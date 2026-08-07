// Which mobile terminal transport this server runs, decided once at boot from
// MULMOTERMINAL_MOBILE_MODE (server/config/env.ts) and read by both the server (which init/routes
// to wire) and — once the frontend phase lands — the UI (GET /api/mobile-mode). The type lives
// here, not in server/ alone, so a value both sides must agree on has exactly one definition.
export const MOBILE_MODES = ["remote", "local"] as const;

export type MobileMode = (typeof MOBILE_MODES)[number];

export function isMobileMode(value: unknown): value is MobileMode {
  return MOBILE_MODES.some((mode) => mode === value);
}
