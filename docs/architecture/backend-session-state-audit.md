# Backend per-session state audit (#187)

This audit applies the ownership rule from Issue #187: Core/tmux owns Terminal membership,
native lifecycle, and durable facts about a live session. Backend state is allowed only when a
concrete viewer, UI, history, or feature owner has a narrower reason to hold it. None of the
states below may introduce Terminal membership or override `Core.exited`.

## Former `server/session/registry.ts` state

| Symbol / file | Fact | Current lifetime / persistence | Readers / writers | Correct owner | Decision | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| `viewerPtys` | Browser PTY transport and replay tail | Process-local; removed on viewer release | spawners, WS/viewer routes, connection handling | Viewer owner | Move | It is transport state, never session existence. |
| `activity` | UI working/waiting/event | Process-local plus `activity-state.json` restart snapshot | hooks/watchers/activity and session routes | Activity owner | Move; delete persistence | A missed event cannot be reconstructed after restart and stale state can contradict `Core.exited`; restart safely resets to idle. |
| `lastPrompts`, `lastResponses` | Display text for the current process | Process-local; cleared on activity end | hook/activity/session presentation | Activity owner | Move | UI decoration only; transcript/history remains the restart fallback. |
| title maps/sets (`titleTurnCounts`, `titlePending`, `titleInFlight`, `titleEpoch`, `lastTitledUserTurns`, `lastTitleAttemptMs`) | Generation counters, locks, invalidation and retry guards | Process-local; cleaned on clear/delete/exit | title manager only | Title owner | Move | Short-lived implementation state belonging entirely to title generation. |
| `codexRolloutIds` / `codex-rollout-ids.log` | MulmoTerminal id to Codex rollout id | Process memory plus append-only log; never pruned | Codex spawn, reconnect, last-turn lookup | Core for live resume identity; Codex history for deleted rows | Delete duplicate | Live sessions already write `Core.resumeSource`; Codex history rows use their rollout id directly. The append-only mirror has no remaining justified reader. |
| `claimedCodexRollouts` | Concurrent rollout attribution exclusion | Process-local; formerly never pruned | Codex spawn watcher | Codex spawn owner | Move | It is an in-flight attribution guard, not durable metadata. Scope it to the spawner instance and expire claims after the 30-minute watcher window. |
| `hookedSessions` | Whether Claude hooks record tool calls | Process-local; never pruned | Claude spawner, MCP history gate | Core agent metadata | Delete | Every Core session with `agent === "claude"` is spawned with hooks; the Set duplicates that durable fact and leaked ids forever. |
| `allToolsSessions` / `all-tools-sessions.json` | Session connected to the full GUI MCP surface | Process memory plus append-only id log; never pruned | MCP route, available-tools route | Core metadata | Move to Core | Durable capability of a live session; it should disappear with Core Delete. |
| `toolGroupsBySession`, reset guards / `session-tool-groups.json` | GUI MCP groups learned for the current native process | Process memory plus append/reset log; never compacted | MCP route, available-tools route, Claude spawn | Core metadata | Move to Core | Durable live capability. Reset on a genuinely new Core process; reattach preserves Core metadata. |
| `backgroundHistoryIds` / `background-sessions.json` | Deleted transcript is background history | Append-only history classification | background/plugin/scheduler writers; history list reader | History owner | Move | It describes past conversations only. It may not classify live membership; live visibility comes from Core. |
| `userScheduledSessions` / `user-scheduled-sessions.json` | Live background session originated from user scheduler | Append-only id log; never pruned | scheduler writer, push policy reader | Core metadata | Move to Core | Durable live classification used only while the Core session exists. Core Delete provides its expiry. |
| `failedWorkers` / `failed-workers.json` | A background history item ended unsuccessfully | Append-only history marker | completion hooks, activity/history rows | History owner | Move | It is a result attached to retained history, not native lifecycle. |
| `antigravityConversations`, written/claimed sets / `antigravity-conversations.jsonl` | Antigravity conversation history, cwd and start time; concurrent attribution guard | History JSONL survives restart; claim/write guards are process-local | Antigravity spawn/reconnect/history list | Antigravity history owner | Move | Core owns the live `resumeSource`; Antigravity does not persist cwd, so history needs the separate cwd/start record. Claims expire after the watcher window. |
| `sessionMemos`, write guards / `session-memos.jsonl` | User memo for deleted conversation history | History JSONL; live legacy copies migrated to Core | memo/session history routes and Delete handoff | History memo owner | Move | User-authored history metadata must survive restart; live memos remain solely in Core. |

## Other Backend per-session state

| Symbol / file | Fact | Lifetime / persistence | Correct owner | Decision / expiry |
| --- | --- | --- | --- | --- |
| `clearedTranscripts` and markers (`cleared-transcripts.ts`) | Claude transcript was cleared and must not be reread | Claude-history marker across restart | Claude history owner | Keep; removed on Claude cleanup/Delete. |
| `activeWaitingMobileWebPushSent` (`hook-routes.ts`) | Push dedupe for an active wait | Process-local | Mobile notification owner | Keep; removed on transition/clear. |
| `announcedSessions` (`mcp-routes.ts`) | MCP-contact pub/sub dedupe | Process-local | MCP owner | Keep; restart intentionally re-announces, and entries expire after 24 hours. |
| `pendingShellCommandCopies` (`local-mobile-terminal-routes.ts`) | Before-screen pending one input response | Process-local | Mobile terminal input owner | Keep; consumed/replaced by the feature and never supplies membership. |
| `historyAdmissionClaims` (`ws-routes.ts`) | Concurrent cold-resume admission lock | Process-local Promise | WS resume owner | Keep; removed in `finally`. |
| `activeTracks` (`codex-activity-track.ts`) | Current Codex rollout tail reader token | Process-local | Codex activity owner | Keep; replacement/exit invalidates it. |
| `completionHooks` (`completion-hooks.ts`) | In-flight feature completion callback | Process-local | Completion feature | Keep; fired or failed on exit/Delete. |
| Core adapter `inputTails`, `exitWatchers` | Serialized input and native-exit observers | Process-local | Core adapter | Keep; tails self-remove, watchers dispose or are removed on exit/Delete. |
| shell task watches (`shell-task-watch.ts`) | Launcher polling timer | Process-local | Shell launcher owner | Keep; stopped on exit/Delete. |
| tmux size-sync maps (`tmux-size-sync.ts`) | Viewer sizing debounce/observations | Process-local | Viewer presentation owner | Keep; forgotten on viewer release. |
| tool store maps/files (`tool-store.ts`) | GUI tool call/result history | Lazy process cache plus feature files | Tool history owner | Keep; durable user-visible history, never membership. Cache ownership is encapsulated. |
| `pendingTranslations` (`translation-worker.ts`) | In-flight worker result Promise | Process-local | Translation feature | Keep; resolved/rejected/timeout cleanup. |
| work-phase `turnTools` (`work-phase-tracker.ts`) | Current UI work-phase evidence | Process-local | Activity/UI owner | Keep; forgotten when activity ends. |
| `launchesInFlight` (`worktree-session-limit.ts`) | Concurrent launch admission count | Process-local | Worktree admission owner | Keep; decremented in `finally`. |
| scheduled-session directory (`scheduled-sessions.ts`) | Retention records for unattended scheduled workers | One file per worker across restart | Scheduler retention owner | Keep; bounded by count and 24-hour TTL, removed after Core Delete. |
| session settings/drop directories | Claude settings and user-uploaded files | Per-process/per-session files | Claude/drop owners | Keep; removed on exit/Delete. |

## Direct tmux boundary

`server/infra/tmux.ts` remains a presentation/viewer integration: attach transport, client
redraw, sizing/window options, mouse, clipboard, hyperlinks, and tmux server presentation
configuration. It must not expose direct session membership, running/exited, pane-command, or
screen fallbacks. Core/tmux-session-core remains the only Backend API for those facts.
