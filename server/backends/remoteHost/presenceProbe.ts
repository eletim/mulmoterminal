// Does the phone still see this host? Asked, rather than assumed.
//
// The host announces itself by writing `users/{uid}/hosts/{hostId}` every minute, and the
// phone decides "is the Mac reachable" from that document's freshness. core writes it with
// `setDoc(...).catch(noop)` — deliberately, since none of its three call sites can await —
// so a write that never lands is invisible on this side. Nothing else notices either: the
// runner only learns of trouble from a Firestore *listener* error, and a listener can stay
// quiet while writes fail. The result was a host reporting itself green while the phone saw
// it offline, with no layer able to disagree (#823 left this as a core-side follow-up).
//
// So this reads the document back from the SERVER and judges it by age. Either answer is
// useful: a read that throws means the connection is genuinely gone, and a read that returns
// a stale document means the heartbeat is not landing. Only a fresh document counts as alive.
import { getDocFromServer } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { hostDoc } from "@mulmoclaude/core/remote-host";
import type { Channel } from "@mulmoclaude/core/remote-host";

// core's heartbeat is one minute. Three of them is the slack a laptop needs to wake up and
// write again before anyone calls it dead — the cost of being wrong here is a reconnect
// cycle, so the threshold leans towards patience.
export const PRESENCE_STALE_MS = 3 * 60_000;

/** `null` = cannot be judged, which is NOT a failure: the document may simply not exist yet
 *  (a runner that has never announced), and treating "no answer" as "dead" would spin a
 *  reconnect loop against a host that is merely new — or against a core that moved the path. */
export type Liveness = boolean | null;

const asMillis = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  // Firestore hands back a Timestamp for serverTimestamp() fields.
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
};

/** Judge a presence document that was read successfully. Exported for its own test: the
 *  freshness rule is the part worth pinning, and it needs no Firestore to check. */
export function presenceIsFresh(data: Record<string, unknown> | undefined, now: number): Liveness {
  if (!data) return null;
  const updatedAt = asMillis(data.updatedAt);
  // A pending serverTimestamp() reads as null until the write is acknowledged; that is a
  // write in flight, not a stale one.
  if (updatedAt === null) return null;
  // `online: false` is core's own goodbye, written on teardown. It is a truthful state, not
  // a broken one — the runner is meant to be down.
  if (data.online === false) return null;
  return now - updatedAt < PRESENCE_STALE_MS;
}

export interface PresenceProbeDeps {
  firestore: () => Firestore;
  channel: Channel;
  now?: () => number;
}

/** Reads the host's own presence document from the server and reports whether it is fresh. */
export function createPresenceProbe(deps: PresenceProbeDeps): () => Promise<Liveness> {
  const now = deps.now ?? Date.now;
  return async () => {
    // From the server, never the cache: a cached copy of our own last write would answer
    // "fresh" precisely when the connection that should have carried it is dead.
    const snapshot = await getDocFromServer(hostDoc(deps.firestore(), deps.channel));
    return presenceIsFresh(snapshot.data(), now());
  };
}
