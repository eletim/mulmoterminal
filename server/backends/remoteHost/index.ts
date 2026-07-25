// Remote-host lifecycle + route wiring for MulmoTerminal.
//
// Binds MulmoTerminal's Firebase deps + hostId to the shared createRemoteHost
// factory (@mulmoclaude/core/remote-host/server) so connecting from the toolbar
// signs in as the user and starts the Firestore command loop + presence heartbeat;
// disconnecting stops both. The transport engine lives in core; this module only
// supplies host specifics (hostId, handler table, session-backed runner, logger)
// and wires the module's lifecycle/session into the injectable routes (routes.ts).
//
// Single-account, single-host (HOST_ID = "mulmoterminal", distinct from the
// MulmoClaude host so the two never compete for the same command queue). The
// Firebase session is parked in the browser (case A', mulmoserver#50), so a server
// restart doesn't force a re-login: the client reconnects from its stored blob. The
// runner reads the CURRENT session's firestore/storage (both change on each
// (re)connect — see session.ts).
import type { Express } from "express";
import { createRemoteHost, startHostRunner, type RemoteHostLifecycle } from "@mulmoclaude/core/remote-host/server";
import { publish, clear, listFor } from "@mulmoclaude/core/notifier";

import type { RunnerHealth } from "../../../common/remoteHostHealth.js";
import { startResilientRunner } from "./resilientRunner.js";
import { createHealthNotice } from "./healthNotice.js";
import { createRemoteHostHandlers, type RemoteHostHandlerDeps } from "./handlers.js";
import { createSaveAttachment } from "./attachmentStore.js";
import { buildIngestAttachments } from "./ingestAttachments.js";
import { onExpire } from "./onExpire.js";
import { currentFirestore, currentStorage, currentUid, exportSession, reconnectErrorStatus, restore, signIn, signOut } from "./session.js";
import { mountRemoteHostRoutes as mountRoutes } from "./routes.js";

// Exported so the session-activity publisher (#439) can address this host's docs; it
// writes from the hook path, outside the lifecycle this module owns.
export const HOST_ID = "mulmoterminal";
const PREFIX = "[remote-host]";

// Module-level singleton — one host runner per process. Null until initialized.
let lifecycle: RemoteHostLifecycle | null = null;

// Health of the live command channel (#823). "offline" until a runner starts, so a host
// that was never connected doesn't claim to be healthy.
let health: RunnerHealth = { state: "offline", lastError: null, changedAt: 0 };
export const currentHealth = (): RunnerHealth => health;

// Everything the handlers need except `ingest`, which this module builds itself — it has to
// read the LIVE session's storage/uid, which only exist once a connection is up. Derived
// rather than restated so a new handler dependency cannot be added in one place only.
export type RemoteHostBackendDeps = Omit<RemoteHostHandlerDeps, "ingest">;

export function initRemoteHostBackend(deps: RemoteHostBackendDeps): void {
  // Ingest pulls the phone's staged uploads (Firebase Storage, signed in as the
  // user) into data/attachments/ and hands startChat path-only attachments. Reads
  // the LIVE session's storage/uid (both change per (re)connect — see session.ts).
  const ingest = buildIngestAttachments({ storage: currentStorage, uid: currentUid, saveAttachment: createSaveAttachment(deps.workspace) });
  const log = {
    info: (msg: string) => console.log(PREFIX, msg),
    warn: (msg: string) => console.warn(PREFIX, msg),
  };
  const notice = createHealthNotice({ publish, clear, list: listFor, log });
  const onHealth = (next: RunnerHealth): void => {
    health = next;
    notice(next);
  };
  lifecycle = createRemoteHost({
    hostId: HOST_ID,
    signIn,
    restore,
    signOut,
    currentUid,
    // Wrapped so a listener death is retried here instead of ending the session: core
    // gives up after five tries (~31s), which any sleep or network move outlasts (#823).
    startRunner: (channel, handlers, options) =>
      startResilientRunner({
        start: (runnerOptions) => startHostRunner(currentFirestore(), channel, handlers, runnerOptions),
        options,
        onHealth,
        log,
      }),
    // Expired offline-queued startChat commands: delete the phone's staged Storage
    // uploads before the runner removes the doc (protocol v2 offline queue).
    onExpire,
    handlers: createRemoteHostHandlers({
      workspace: deps.workspace,
      spawnChat: deps.spawnChat,
      ingest,
      listTerminalSessions: deps.listTerminalSessions,
      captureTerminalScreen: deps.captureTerminalScreen,
      writeToSession: deps.writeToSession,
      canClearBox: deps.canClearBox,
      submitSequence: deps.submitSequence,
    }),
    log: { ...log, debug: () => undefined },
  });
}

export interface RemoteHostRouteOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

export function mountRemoteHostRoutes(app: Express, { isAllowedOrigin }: RemoteHostRouteOptions): void {
  mountRoutes(app, { isAllowedOrigin, getLifecycle: () => lifecycle, exportSession, reconnectErrorStatus, currentHealth });
}
