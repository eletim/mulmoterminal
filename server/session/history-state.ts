// Metadata for retained conversations after Core membership is gone. This module decorates only
// history rows; live visibility, failure/lifecycle, and membership always come from Core.
import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import { messageOf } from "../errors.js";
import { parseSessionIdLog, sessionIdLogLine } from "./session-id-log.js";

const validId = (id: string) => SESSION_ID_RE.test(id);

function createHistoryFlagStore(file: string, label: string) {
  const ids = new Set<string>();
  const hydrated = (async () => {
    try {
      for (const id of parseSessionIdLog(await fs.readFile(file, "utf8"), validId)) ids.add(id);
    } catch {
      // Missing on first run or unreadable means no retained classification.
    }
  })();
  let persist: Promise<void> = Promise.resolve();
  return {
    hydrated,
    has: (id: string) => ids.has(id),
    mark: (id: string) => {
      if (!validId(id) || ids.has(id)) return;
      ids.add(id);
      persist = persist
        .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
        .then(() => fs.appendFile(file, sessionIdLogLine(id)))
        .catch((error) => console.error(`[${label}] failed to persist: ${messageOf(error)}`));
    },
  };
}

const backgroundHistory = createHistoryFlagStore(path.join(MULMOTERMINAL_HOME, "background-sessions.json"), "background-history");
const failedWorkerHistory = createHistoryFlagStore(path.join(MULMOTERMINAL_HOME, "failed-workers.json"), "failed-worker-history");

export const backgroundHistoryHydrated = backgroundHistory.hydrated;
export const failedWorkerHistoryHydrated = failedWorkerHistory.hydrated;
export const markBackgroundHistory = backgroundHistory.mark;
export const isBackgroundHistory = backgroundHistory.has;
export const markFailedWorkerHistory = failedWorkerHistory.mark;
export const isFailedWorkerHistory = failedWorkerHistory.has;
