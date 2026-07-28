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
// Red and filled, not a grey empty ring. Offline is the state where the phone can reach
// nothing and someone has to act, yet it used to be drawn quieter than either of the two
// states that need no attention — so the toolbar looked calmest exactly when it was worst.
const OFFLINE: RemoteHostView = { label: "Offline", icon: "cloud_off", toneClass: "text-err-strong", online: false, reconnecting: false };

export function remoteHostView(connected: boolean, state: RunnerHealthState): RemoteHostView {
  if (state === "reconnecting") return RECONNECTING;
  return connected && state === "online" ? ONLINE : OFFLINE;
}

/** Whether the TOOLBAR — the part visible without opening anything — should show alarm.
 *
 *  Offline is not by itself a problem: most people never set the phone link up, and a
 *  permanently red toolbar for a feature they don't use is worse than saying nothing.
 *  `parked` is what separates the two, being the session blob kept only for someone who
 *  did connect; an explicit Disconnect drops it, so choosing to switch off stays quiet.
 *
 *  `loaded` gates the very first render: every field starts at its disconnected default,
 *  so without it a page load flashes red before the first status even arrives. */
export const remoteHostAlarm = (view: RemoteHostView, parked: boolean, loaded: boolean): boolean => loaded && parked && !view.online && !view.reconnecting;
