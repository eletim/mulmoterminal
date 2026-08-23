# refactor(#111/#112): Session lifecycle と SoT

Issue #112 の調査結果。v1.1.0 の Session 管理再設計では、この文書を #111 の設計ベースにする。

この調査では大規模な実装変更はしない。結論は、現在の `ptys` / tmux / transcript / grid localStorage / mobile cache / activity / unplaced markers をそのまま SoT とみなすのではなく、backend に「ユーザーから見た有効な Session 集合」を表す registry を新設し、PC と Mobile はその同じ集合から表示候補を作る、である。

## 用語

- User-visible Session: PC grid または Mobile でユーザーが見つけ、画面を読み、必要なら入力や stop できる対象。
- Runtime: PTY、tmux session、WebSocket、agent process など実行/I/O の実体。
- Metadata: transcript、Codex rollout mapping、cwd、title、memo、activity、work phase など、表示や cold resume に必要な補助情報。
- Placement: PC grid のどの cell にいるか、またはまだ cell に採用されていないか。

## 現行 lifecycle

### 1. Session ID 生成

主な生成点は複数ある。

- PC WebSocket: `server/routes/ws-routes.ts`
  - Claude は `resolveClaudeSession()` が requested id を live PTY / tmux / transcript で継続可能か判定し、不可なら `randomUUID()` で新規 id を作る。
  - launcher / Codex / Antigravity は `resolveReattachableId()` 系で live PTY / tmux / rollout/conversation を見て、不可なら新規 id を作る。
- Mobile 新規作成: `server/mobileTerminal/localMobileTerminalLauncher.ts`
  - `createLocalMobileTerminalCreator()` が `randomUUID()` で id を作り、viewer なし (`ws=null`) で PTY を spawn する。
- background / scheduled / feed worker: `server/index.ts`
  - `feedsSpawnWorker()` や `spawnScheduledChat()` が `randomUUID()` で id を作り、visible/hidden の違いに応じて marker を残す。

この時点で id は必ずしも transcript を持たない。Claude transcript は最初の prompt 後に作られるため、spawn 直後の存在は `ptys` と `knownSessions` だけで表現される。

### 2. Spawn / attach

- 実行実体は `ptys` (`server/session/registry.ts`) に `PtyEntry` として入る。
- `PtyEntry` は `term`, `ws`, `buffer`, `cwd`, `tmux`, `active`, `agent` を持ち、live runtime と attach 状態を同じ entry で表す。
- `server/session/pty-spawn.ts` は `persistent=true` かつ tmux がある場合、`tmux new-session -A` を使う。
  - 既存 tmux session があれば attach。
  - なければ新規 tmux session を作って agent/shell を起動。
- `server/infra/tmux.ts` は `destroy-unattached off` の専用 tmux server (`-L mulmoterminal`) を使うため、node server が落ちても tmux session は残る。

### 3. Client attach / reconnect

PC:

- `src/composables/useTerminalConnections.ts` は Vue component の mount/unmount から WebSocket/xterm を分離した singleton manager。
- `attach()` は slot を DOM に re-parent し、既存 slot なら接続を維持する。
- `detach()` は socket を閉じず、view だけ外す。
- `retarget()` / `release()` / `terminate()` は socket を閉じる。socket close は server 側で detached として扱われる。
- reconnect は `knownSessionId ?? target.sessionId` を `session` query に乗せて再接続する。

Server:

- `server/session/pty-connection.ts`
  - `reattachPty()` は同じ id の live `PtyEntry` に新 socket を差し替え、古い socket に `superseded` を送る。
  - `handleClientClose()` は `entry.ws = null`, `entry.active = false` にして `armReapForDetached()` を呼ぶ。
  - 明示 terminate frame は `reap()` を即時実行する。
- `server/routes/ws-routes.ts` の `admitAgentSession()` は attach の chokepoint。
  - grid cell なら `markDevTerminalSession()`。
  - viewer がついたら `markAttachedSessionPlaced(sessionId, requested)`。
  - `session` frame で server が決めた id/cwd を browser に返し、browser は localStorage の cell に反映する。

### 4. Detached

現行の detached は永続状態ではない。複数の意味が混ざっている。

- Server runtime detached: `ptys.get(id)?.ws === null`。socket がないが PTY はある。
- Mobile row detached: `TerminalSessionSummary.live === false`。この server process に `PtyEntry` がない。tmux-only survivor でも transcript-only stale でも false になり得る。
- tmux detached: tmux session はあるが browser/client がついていない。`tmuxAttachedClientCount()` や `tmuxAttachedCounts()` は「誰かが持っているか」の警告用途で、Session 集合の SoT ではない。

detached の auto-reap は `server/session/lifecycle.ts` と `server/session/reap-policy.ts` に分かれている。

- socket close で `entry.ws = null` になり、`armReapForDetached()` が呼ばれる。
- reattach は `cancelReap()` で grace timer を取り消す。
- `activity.working` は原則 keep。作業中の session は auto-reap しない。
- `activity.waiting` は長い grace。既定は 30 分で、`WAIT_REAP_GRACE_MS <= 0` なら auto-reap しない。
- idle detached は短い grace。既定は 30 秒。
- `event === "Notification"` の waiting は working より先に判定される。権限待ちなどで `working=true` が残り続ける session を無限保持しないため。
- shell session は foreground child process がある間 keep され、終わった直後も `unacknowledgedShellDone` として screen が見られるまで keep される。

したがって `SessionRecord.lifecycle = "detached"` を導入するときは、単に socket が無い状態だけでなく、現行の keep / short grace / long grace / no-auto-reap / shell foreground keep を preserve する必要がある。stale pruning はこの grace state を見ずに detached record を消してはいけない。

### 5. Reap / stop / exit

`server/session/lifecycle.ts` の `reap()` が live `PtyEntry` の終了点。

`reap()` が消すもの:

- `ptys`
- `knownSessions`
- `launchChoices`
- `lastPrompts`
- `lastResponses`
- cleared transcript mark
- AI title / work phase / terminal size bookkeeping
- session settings / drops
- `activity` は `shouldForgetActivity()` が true のときだけ消す
- tmux-backed entry なら `tmuxKillSession(id)`

`reap()` が消さないもの:

- transcript / Codex rollout
- `devTerminalSessions`
- `unplacedSessions` / `placedSessions` append logs
- `sessionCwds`
- `sessionMemos`
- `codexRolloutIds`
- `antigravityConversations`
- background/user-scheduled/failed-worker marks

つまり `reap()` は live runtime の終了であって、履歴や UI 補助 metadata の削除ではない。この境界が現在の「実体がないが一覧に見える」状態の原因になる。

Mobile stop:

- `server/mobileTerminal/sessionOperations.ts` は `reapSession(id)` を呼び、tmux があれば `killTmux(id)` も呼ぶ。
- ただし `reap()` は `ptys` がない場合 no-op のため、tmux-only survivor は `killTmux()` 側で止まる。

## 現行 state / persistence の責務

| State | 場所 | 永続 | 現行責務 | SoT としての問題 |
| --- | --- | --- | --- | --- |
| `ptys` | `server/session/registry.ts` | no | live PTY, attached socket, buffer, cwd, agent | server restart で空になる。tmux survivor を表せない。 |
| tmux session | `server/infra/tmux.ts` | process 外 | runtime survival / screen capture / reattach | id と実行実体はあるが cwd/agent/title/placement を完全には持たない。 |
| `knownSessions` | `server/session/registry.ts` | no | transcript 未作成の新規 Claude を sidebar に出す pending row | live runtime の補助。restart で消え、Session existence 全体を表せない。 |
| `devTerminalSessions` | `server/session/registry.ts` | append log | grid/dev-terminal session を chat sidebar から除外し、Mobile grid session 判定にも使う | 分類であって存在ではない。reap 後も残る。 |
| `unplacedSessions` | `server/session/registry.ts` | append log | visible だが PC grid cell に採用されていない session を次の grid が拾う | placement queue であって存在ではない。runtime が消えても残り得る。 |
| `placedSessions` | `server/session/registry.ts` | append log | unplaced mark を再採用しないための tombstone | placement tombstone。存在とは逆方向の補助情報。 |
| `activity` | `server/session/registry.ts` | selective snapshot | working/waiting/event, desktop/mobile status, attention, push | done/waiting を残すため runtime 終了後も残る。存在 SoT にすると zombie になる。 |
| persisted activity | `server/session/activity-state.ts` | JSON | restart 後に working/waiting 表示を復元 | activity hydrate race 対策。runtime existence とは別。 |
| transcript | `server/session/session-reads.ts` | agent disk | chat/session履歴、Claude cold resume、title/prompt/usage/context/timeline | finished history も全て含む。存在 SoT にすると過去履歴が全部 live session になる。 |
| Codex rollout mapping | `codexRolloutIds` | append log | MulmoTerminal id から Codex rollout id へ cold resume | mapping だけで runtime existence はない。 |
| Antigravity conversation mapping | `antigravityConversations` | JSONL | MulmoTerminal id から Antigravity conversation id / cwd へ cold resume | mapping だけで runtime existence はない。hydration 前に読むと restart survivor を resume できない。 |
| `sessionCwds` | `server/session/registry.ts` | append log | restart 後/ptysなし session の cwd 補完 | cwd metadata。存在ではない。 |
| `sessionMemos` | `server/session/registry.ts` | JSONL | user memo | user metadata。存在ではない。 |
| PC grid localStorage | `src/components/gridTabs.ts`, `GridView.vue` | browser localStorage | cell配置、session id、cwd、agent、launcher | browserごとの UI state。backend生存sessionを網羅しない。 |
| Mobile localStorage cache | `src/components/MobileTerminalPage.vue` | browser localStorage | stale表示継続と画面cache | UX cache。SoTではなく、失敗時も表示を残す設計。 |

## PC の Session 集合生成

PC には複数の集合がある。

### Chat/sidebar `/api/sessions`

`server/routes/session-routes.ts` の `sessionList()`:

- `projectSessionsDir(cwd)` の `.jsonl` を読む。
- `knownSessions` を pending として混ぜる (`collectPendingSessions()`)。
- unscoped query では `devTerminalSessions` を除外する。
- background / failed / memo / activity を row に合成する。
- tmux attached count は row の `attached` 警告用で、一覧候補の SoT ではない。

これは「履歴/チャット一覧」であって、grid 上の active session 集合ではない。

### Grid cell 集合

`src/components/GridView.vue` / `src/components/gridTabs.ts`:

- `grid_v2` localStorage の `cells` が PC grid の配置 SoT。
- cell は `session`, `cwd`, `agent`, `launcher`, `command`, `parked` を持つ。
- component mount 時に `useTerminalConnections.attach()` で WebSocket を張り、server の `session` frame を受けて cell の `session` を更新する。
- `useGridActivity()` は localStorage cells の session ids に対して `/api/activity?ids=...` を読む。これは表示 status の補助で、cell 集合の生成元ではない。

### Unplaced 採用 `/api/sessions/unplaced`

`GridView.vue` の `adoptUnplacedSessions()`:

- `/api/sessions/unplaced` を fetch。
- まだ grid state にない id を `insertCellAfter()` で cell にする。
- grid が満杯なら server mark は消さず、次回に持ち越す。

`server/routes/session-routes.ts` の `/api/sessions/unplaced`:

- `unplacedSessionsHydrated` と `placedSessionsHydrated` を待つ。
- `unplacedSessionRows()` を返す。
- live `ptys` があれば agent/cwd は entry を優先、なければ marker の agent と `cwd:null`。

この経路は「backendで visible にspawnされたが PCにまだ置かれていない」ものだけを拾う。PC grid の通常 session 集合は browser localStorage が持っている。

## Mobile の Session 集合生成

`server/index.ts` の `mobileListTerminalSessions()`:

1. `liveIds = [...ptys.keys()]`
2. `tmuxIds = tmuxListSessionIds()`
3. `candidateIds = mobileActivityCandidateIds(...)`
   - live/tmux に含まれない
   - `activity` が working または waiting
   - `isPhoneListableSession(id)` が true
4. `ids = liveIds ∪ tmuxIds ∪ candidateIds`
5. `persistentMobileDetails()` で title/cwd/agent を補完
6. `buildSessionList()` で以下を filter
   - `isResumable` (`resumableSessionPredicate()`)
   - `isGridSession` (`isPhoneListableSession()`)
   - title が空なら live session だけ残す

`isPhoneListableSession()` は `devTerminalSessions.has(id) || (unplacedSessions.has(id) && !placedSessions.has(id))`。

つまり Mobile は「live/tmux/activity candidates のうち、grid session または unplaced と判断できるもの」を出している。PC grid の localStorage cell 集合とは違う。

### Mobile screen / input / reattach

- screen: `captureSessionScreen()` は tmux capture を優先し、なければ `ptys` buffer を headless render する。
- input: `createTerminalInputSender()` は `writeToSession()` に書く。
- `writeToSession` は `server/session/tmux-adopt.ts` の `createAdoptingTerminalWriter()`。
  - `ptys` に entry がなければ、tmux がある場合に `spawnLauncherPty(sessionId, null, command, cwd)` で tmux session を adopt してから書く。
  - これにより tmux-only survivor は Mobile 入力時に server process の `ptys` へ戻る。
- Mobile UI は `session.live` が false なら入力フォームを出さないため、現状の UX では detached 行に直接入力できない。HTTP backend は adopt 可能だが、UI gate は `live` を要求する。
- `/api/mobile/terminal-sessions/:id/launch` は PC側へ launch request を publish する経路で、Mobile 自身の reattach ではない。

## server restart 後の復旧

復旧するもの:

- tmux session: node restart 後も残る。
- activity: `activity-state.json` から working/waiting/event を hydrate。
- dev terminal ids / unplaced / placed / cwd / memo / rollout mappings / Antigravity conversation mappings: append logs または JSONL から hydrate。
- transcript/rollout: agent の disk から読む。

復旧しないもの:

- `ptys`: process memory なので空。
- `knownSessions`: transcript 未作成 pending row は消える。
- `launchChoices`: process lifetime。
- live output buffer: `ptys` buffer は消える。ただし tmux capture で画面は読める。

復旧経路:

- PC WebSocket は requested id を持って reconnect し、`tmuxHasSession(id)` が true なら同じ id を維持する。
- `ptySpawn()` が `tmux new-session -A` で surviving tmux session に attach し、新しい `PtyEntry` を `ptys` に作る。
- Mobile list は `tmuxListSessionIds()` を候補に含め、screen は `tmuxCaptureStyledPane()` で読める。

## 不整合パターン

### 1. placed/unplaced が存在管理に見える

`unplacedSessions` は「まだ cell がない visible spawn」を表すが、runtime が死んでも自動では消えない。`placedSessions` はその反対の tombstone で、存在ではない。Mobile の `isPhoneListableSession()` はこの placement marker を grid session 判定に使っているため、placement と existence が混ざっている。

### 2. `devTerminalSessions` が分類と existence を兼ねている

`devTerminalSessions` は chat sidebar から grid session を隠すための分類 log。append-only であり、reap 後も残る。Mobile は `devTerminalSessions` を listing eligibility に使うため、古い分類が残ると transcript/metadata と結びついて stale row の原因になる。

### 3. `activity` が存在に見える

`reap()` は waiting/working を持つ activity を残し得る。これは bold-until-viewed / notification 用には正しいが、存在 SoT として使うと zombie になる。Mobile は activity candidates を session candidate に追加しているため、activity と listability の組み合わせで実体のない row が出る余地がある。

### 4. transcript は履歴であって live existence ではない

`/api/sessions` は transcript を主に読む。transcript は cold resume には必要だが、過去履歴も全て含む。これを backend active session とみなすと、終了済み会話が active session として扱われる。

### 5. PC と Mobile の集合が違う

- PC grid: browser localStorage cells + unplaced adoption。
- Mobile: live ptys + tmux ids + activity candidates を `devTerminalSessions ∨ unplaced` で filter。
- Chat/sidebar: transcript + known pending, unscoped では dev terminal を除外。

同じ「Session一覧」という言葉でも、三者が別の集合を作っている。

### 6. Mobile cache が stale row を見せ続ける

Mobile UI は `mulmoterminal.mobileTerminalPage.v1` に sessions/selection/screen を保存し、fetch失敗時も現在表示を残す。これは UX として正しいが、cache は SoT ではない。server 側で存在が消えていても一時的に見え続ける。

### 7. tmux-only survivor の metadata 欠落

tmux は id と screen と pane command を持つが、cwd/title/agent は完全ではない。`sessionCwd`, transcript summary, rollout mapping, tmux pane command から補完しているが、補完元ごとに欠落条件が違う。

## 推奨 SoT

v1.1.0 では backend に `SessionRegistry` を新設し、「ユーザーから見た有効な Session」を一つの集合として表す。

推奨する registry row:

```ts
interface SessionRecord {
  id: string;
  agent: "claude" | "codex" | "antigravity" | "shell";
  cwd: string;
  visibility: "grid" | "background" | "internal";
  lifecycle: "starting" | "live" | "detached" | "stopped" | "failed";
  runtime: {
    pty: boolean;
    tmux: boolean;
  };
  resume: {
    claudeTranscript?: boolean;
    codexRolloutId?: string;
    antigravityConversationId?: string;
  };
  placement: {
    gridCell: boolean;
    unplaced: boolean;
  };
  createdAt: number;
  updatedAt: number;
  stoppedAt?: number;
}
```

重要な定義:

- SoT は transcript ではなく `SessionRecord`。
- tmux / PTY は `runtime` detail。
- placed / unplaced は `placement` detail。
- Mobile cache / PC localStorage は UI state。
- activity は status/attention detail。
- transcript/rollout は cold resume と metadata detail。

「backend上で有効な Session」は以下のいずれかを満たす `SessionRecord`:

- `lifecycle` が `starting`, `live`, `detached`。
- または `lifecycle=stopped` でも、明示的に履歴/resume list に出す route が要求した場合だけ対象にする。

PC grid と Mobile は `visibility=grid` かつ `lifecycle in starting/live/detached` を同じ API から読む。Chat/history は別 API とし、transcript/rollout の履歴一覧を読む。

## 移行方針

段階的に進める。

### Phase 1: read-only aggregator

- 既存 store を変更せず、`session/records.ts` のような read-only aggregator を追加する。
- 入力:
  - `ptys`
  - `tmuxListSessionIds()`
  - `devTerminalSessions`
  - `unplaced/placed`
  - `activity`
  - `sessionCwd`
  - transcript/rollout/Antigravity conversation metadata
- 出力:
  - `SessionRecord[]`
  - `gridVisibleSessions()`
  - `historySessions()`
- まず PC/Mobile の list endpoint だけ aggregator を読むようにする。

### Phase 2: lifecycle writes を registry に集約

- spawn/admit/reap/stop/exit で `SessionRecord` を更新する。
- `markDevTerminalSession`, `markUnplacedSession`, `markSessionPlaced` は registry write の一部にする。
- append-only legacy logs は互換読み込みに残すが、新規書き込みを registry に寄せる。

### Phase 3: PC/Mobile list unification

- `/api/sessions/unplaced` を `grid sessions?placement=unplaced` に置き換える。
- Mobile `/api/mobile/terminal-sessions` は同じ grid-visible records を読む。
- PC grid localStorage は cell placement/ordering だけを持ち、存在 discovery は backend records から行う。

### Phase 4: cleanup / stale pruning

- registry row の `stoppedAt` / `updatedAt` を使って stale stopped records を pruning。
- transcript/rollout 履歴は history route に残し、active grid/mobile list からは除外。
- detached row は現行の `reapDecisionFor()` と shell foreground / unacknowledged done の keep 条件を preserve してから pruning する。
- legacy logs の読み込みを migration 期間後に削除する。

## 実装 Issue 分割案

1. `SessionRecord` read-only aggregator を追加する。
   - 既存 store から user-visible grid session set を作る純粋関数と unit test を追加。
   - PC/Mobile の現行差異をテストで固定してから、目標差異を別テストにする。

2. PC/Mobile の session list API を aggregator に寄せる。
   - `/api/mobile/terminal-sessions` と `/api/sessions/unplaced` の候補生成を共通化。
   - `devTerminalSessions` / `unplaced` を existence ではなく classification/placement として扱う。

3. Session lifecycle writer を導入する。
   - spawn/admit/reap/stop/exit で `SessionRecord` を更新。
   - `ptys` は runtime table として残し、registry row の有無を user-visible existence とする。

4. tmux-only survivor の metadata hydration を registry に集約する。
   - server restart 後、tmux ids と persisted cwd/agent/resume mapping から `detached` records を復元。
   - agent/cwd 不明時の fallback と UI表示を明文化。

5. stale/zombie pruning を実装する。
   - runtime なし、tmux なし、resume metadata なし、placement marker だけの record を消す。
   - activity だけ残る session を active list に出さない。

6. PC grid placement を backend existence から分離する。
   - localStorage は cell order/layout のみ。
   - backend record が stopped なら cell は明示的な closed/ended state にする。
   - unplaced adoption は registry placement transition に置き換える。

7. Mobile cache と detached 操作の整理。
   - cache は stale indicator を持たせるか、server list 成功時にだけ existence として扱う。
   - tmux-only detached row に対して reattach/adopt してから input できる UX を決める。

## main 統合前の統合テスト項目

- PC grid で Claude/Codex/Antigravity/shell を新規開始し、Mobile 一覧に同じ集合が出る。
- Mobile で Claude/Codex/Antigravity/shell を新規開始し、PC grid が unplaced として採用できる。
- PC browser を全て閉じても backend/tmux session が維持され、再度 PC を開くと同じ session が見つかる。
- Mobile tab を background/foreground しても stale cache が SoT として残らず、server 成功時に正しい list に戻る。
- server restart 後、tmux survivor が PC/Mobile の両方で見つかり、screen capture できる。
- server restart 後、PC reconnect が same id の tmux session に reattach し、新規 id を作らない。
- server restart 後、Mobile detached row から reattach/adopt して input できる方針どおりに動く。
- explicit stop / cell close / idle reap が registry, ptys, tmux, placement, activity を矛盾なく更新する。
- transcript だけ残る古い session が active grid/mobile list に出ない。
- activity だけ残る waiting/done session が active existence を偽装しない。
- unplaced marker だけ残る session が zombie row にならない。
- grid localStorage にあるが backend/tmux/resume がない session が明確な ended/stale UI になる。
- `devTerminalSessions` に残る過去 id が Mobile active list を汚染しない。
- tmux session はあるが cwd/agent metadata がない場合の fallback 表示と操作が仕様どおり。
- background/internal sessions が grid/mobile active list に漏れない。

## 結論

現行の「Sessionが存在する」判定は一箇所にない。

- runtime existence は `ptys` と tmux。
- cold-resume possibility は transcript/rollout/conversation。
- user-visible grid eligibility は `devTerminalSessions` と `unplacedSessions`。
- PC placement は browser localStorage。
- Mobile list は live/tmux/activity candidates を phone-listable predicate で filter。
- activity は attention/status だが、runtime 終了後も残る。

v1.1.0 では、これらを直接 UI が組み合わせる構造をやめ、backend `SessionRecord` を user-visible Session の SoT にする。`ptys`、tmux、transcript、activity、placed/unplaced、localStorage、Mobile cache はすべて `SessionRecord` に付随する runtime / metadata / placement / UI cache として扱う。
