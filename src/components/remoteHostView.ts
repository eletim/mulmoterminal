// How the toolbar renders the remote-host channel. Split out of RemoteHostControl.vue so
// the rule is assertable without mounting the Firebase-importing component.
//
// The rule that matters: "Online" needs BOTH a connected lifecycle and a live
// subscription. Before #823 the toolbar read `connected` alone, so it stayed green while
// the runner was dead and the phone could reach nothing.
import type { RunnerHealthState } from "../../common/remoteHostHealth";

export interface RemoteHostView {
  label: string;
  icon: string;
  toneClass: string;
  online: boolean;
  reconnecting: boolean;
}

const RECONNECTING: RemoteHostView = { label: "Reconnecting…", icon: "sync", toneClass: "text-[#e0a526]", online: false, reconnecting: true };
const ONLINE: RemoteHostView = { label: "Online", icon: "check_circle", toneClass: "text-[#35c46a]", online: true, reconnecting: false };
const OFFLINE: RemoteHostView = { label: "Offline", icon: "radio_button_unchecked", toneClass: "text-muted", online: false, reconnecting: false };

export function remoteHostView(connected: boolean, state: RunnerHealthState): RemoteHostView {
  if (state === "reconnecting") return RECONNECTING;
  return connected && state === "online" ? ONLINE : OFFLINE;
}
