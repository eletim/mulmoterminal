// Process-local UI decoration. Restart intentionally starts idle: agent events cannot be replayed
// reliably, and restoring a stale working/waiting flag could contradict Core.exited.
import type { Activity } from "./types.js";

export const activity = new Map<string, Activity>();
export const lastPrompts = new Map<string, string>();
export const lastResponses = new Map<string, string>();
