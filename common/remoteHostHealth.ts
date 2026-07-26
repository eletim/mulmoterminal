// Health of the remote-host command channel, as reported by the server's resilient
// runner and rendered by the toolbar control. Shared across the build boundary so the
// two sides cannot drift on the state names.
//
//   online       — the Firestore subscription is up; the phone can reach this host
//   reconnecting — it died and is being re-subscribed with backoff (self-healing)
//   offline      — re-subscribing stopped helping, or nothing is connected at all;
//                  recovering needs a re-auth from the browser's parked session

import { isRecord } from "./isRecord.js";
export const RUNNER_HEALTH_STATES = ["online", "reconnecting", "offline"] as const;
export type RunnerHealthState = (typeof RUNNER_HEALTH_STATES)[number];

export interface RunnerHealth {
  state: RunnerHealthState;
  /** Last listener error seen, for the popover and the log. Null before the first one. */
  lastError: string | null;
  /** ms epoch of the last state change, so the UI can say how long it has been down. */
  changedAt: number;
}

export const isRunnerHealthState = (value: unknown): value is RunnerHealthState => RUNNER_HEALTH_STATES.some((state) => state === value);

/** Narrows a parsed HTTP payload. The client renders whatever this accepts, so a
 *  half-shaped health has to read as "no health reported" rather than as a state. */
export const isRunnerHealth = (value: unknown): value is RunnerHealth =>
  isRecord(value) &&
  isRunnerHealthState(value.state) &&
  (value.lastError === null || typeof value.lastError === "string") &&
  typeof value.changedAt === "number";
