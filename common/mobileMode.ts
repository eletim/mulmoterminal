// The mobile terminal transport this server exposes. External-server remote mode was removed;
// this value remains shared so `/api/mobile-mode` and the mobile UI agree on the local-only mode.
export const MOBILE_MODES = ["local"] as const;

export type MobileMode = (typeof MOBILE_MODES)[number];

export function isMobileMode(value: unknown): value is MobileMode {
  return MOBILE_MODES.some((mode) => mode === value);
}
