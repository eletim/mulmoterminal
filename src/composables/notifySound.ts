// Raising one of the notifications the BROWSER sees.
//
// useAttentionSound listens to the session activity stream, which covers everything a server
// hook reports. The rest has no hook behind it — a Run cell's PTY is ephemeral and never
// reaches the session registry, and a PR's phase is something this page polls — so the
// component that observes the moment calls this instead.

import { useSoundEnabled } from "./useSoundEnabled";
import { currentSoundConfig } from "./useAppConfig";
import { playNotify } from "./useAttentionSound";
import type { NotifyKind } from "../../common/notifyKinds";

export function notifySound(kind: NotifyKind, cwd: string | null): void {
  const { enabled } = useSoundEnabled();
  const config = currentSoundConfig();
  if (!enabled.value || !config.kinds.includes(kind)) return;
  playNotify(kind, cwd, config);
}

/** Which notification a finished Run command raises. A start failure reports no code, and is
 *  a failure — the command did not run. */
export const commandExitKind = (exitCode: number | null): NotifyKind => (exitCode === 0 ? "command-done" : "command-failed");
