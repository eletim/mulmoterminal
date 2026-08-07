// Exclusive dispatch on MOBILE_MODE (config/env.ts) between the two mobile terminal transports —
// the Firestore remote host and the local same-origin HTTP API. Pulled out of index.ts as a tiny
// pure dispatcher so "each mode mounts its own routes and never the other's" is a fact a test can
// assert against real production wiring, rather than something only checkable by reading
// index.ts's switch statement by eye.
import type { MobileMode } from "../common/mobileMode.js";

export interface MobileTransportMountDeps {
  mode: MobileMode;
  // init the Firestore backend + mount its routes. Called only for "remote".
  mountRemote: () => void;
  // mount the local HTTP terminal API. Called only for "local".
  mountLocal: () => void;
}

export function mountMobileTransport({ mode, mountRemote, mountLocal }: MobileTransportMountDeps): void {
  switch (mode) {
    case "remote":
      mountRemote();
      break;
    case "local":
      mountLocal();
      break;
  }
}
