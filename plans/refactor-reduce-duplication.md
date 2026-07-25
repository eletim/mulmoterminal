# refactor: 重複コードの削減 — `common/` への集約と jscpd alert 解消

issue: #826

## 背景

GitHub code scanning (jscpd, min-tokens 50) が duplicate-code の alert を 4 件出している。
しきい値を 30 に下げて全体を測ると 62 件で、その内訳は:

| 種別 | 件数 |
| --- | --- |
| `server/` ↔ `src/` をまたぐコピー | 9 |
| 同一レイヤ内・別ファイル | 33 |
| 同一ファイル内 | 20 |

このうち **`server/` ↔ `src/` をまたぐ 9 件** が「重複が増えた」の主因。
`common/` は `tsconfig.server.json` と `tsconfig.app.json` の**両方に include されており**、
`common/dirChrome.ts` / `themeColors.ts` / `modelPresets.ts` は既に両側から import されている。
にもかかわらず新しい共有値は `common/` に置かれず両側にコピーされている。

原因は誤ったコメント。`server/backends/remoteHost/firebase.ts` と `src/config/firebaseConfig.ts` の双方に:

> サーバの tsconfig は src/ に入れないので、共有モジュールを import せずミラーするのが
> MulmoTerminal の慣習。2つのコピーを同期すること

とあるが、これは現状と一致しない。この記述自体がコピーを再生産している。

## 方針

**純粋なリファクタ。振る舞いは 1 バイトも変えない。**

特に拡張子リスト (#108) は、2 つの集合が**意図的に異なる**。共通部分だけを共有定数にし、
各側の差分は差分として明示的に残す。「grep で一致したから全部揃える」は挙動を壊す。

## A. CI が出している 4 alert

### alert 106 — `TerminalCell.vue` 1012-1024 ↔ 1109-1121 (84 tokens)

expand/restore + close ボタンの `<span class="cell-actions">` が完全に同一で 2 箇所。
`CockpitHeader` を使う filmstrip 版と、通常グリッド版のヘッダで同じものを描いている。

→ `src/components/CellActions.vue` に抽出。props は `expanded`、emit は `toggle-expand` / `close`。
   クラス定数 (`CELL_ACTIONS` / `CELL_BTN` / `CELL_CLOSE_BTN`) は props で渡さず
   抽出先で import する。

### alert 107 — `AppRouteDeps` ↔ `HookDeps` (63 tokens)

両者が同じ 7 フィールドを宣言している:
`setWorking` / `setWaiting` / `publishActivity` / `forgetTitle` / `noteTitleTurn` /
`noteWorkPhase` / `maybeGenerateTitle`。

`app-routes.ts` はこれらを `mountHookRoute` にそのまま転送しているだけなので、実体は同一契約。

→ `server/session/session-activity-deps.ts` に `SessionActivityDeps` を定義し、
   `AppRouteDeps` と `HookDeps` の双方が `extends` する。

### alert 108 — `TEXT_EXTS` ↔ `IN_APP_EXTENSIONS` (50 tokens)

集合の実測:

| | 件数 |
| --- | --- |
| 共通部分 | 45 |
| `TEXT_EXTS` のみ | 18 |
| `IN_APP_EXTENSIONS` のみ | 1 |

- 共通 45: `.ts .tsx .js .jsx .mjs .cjs .vue .svelte .astro .py .rb .go .rs .java .kt .c .h
  .cpp .cc .hpp .cs .php .swift .scala .lua .sql .sh .bash .zsh .fish .yml .yaml .toml
  .ini .cfg .conf .css .scss .sass .less .xml .jsonc .log .diff .patch`
- `TEXT_EXTS` のみ 18: `.md .markdown .rst .adoc .mdx .pl .r .dart .ex .exs .env
  .properties .html .htm .gitignore .dockerignore .editorconfig .lock`
  （`.md` 系はクライアントでは md ビューアにルーティングされる。`.html` はクライアントでは
  raw ルートに行く。ドットファイルはサーバのみが扱う）
- `IN_APP_EXTENSIONS` のみ 1: `.txt`
  （サーバ側は `MIME_BY_EXT` が `.txt` を持っているので `TEXT_EXTS` に不要）

→ `common/sourceExtensions.ts` に共通 45 件を `SOURCE_CODE_EXTENSIONS` として定義。
   両側はこれを spread し、自分の差分を明示的に足す。**結果の集合は現状と完全に一致させる。**

### alert 102 — `SessionTabBar.vue` ↔ `Sidebar.vue` の `<script setup>` 冒頭

`defineProps` / `defineEmits` は Vue のコンパイラマクロでコンポーネント内にしか書けず、
props/emits の型と filter ロジックは既に `composables/sessionList.ts` で共有済み。
レイアウト自体（`<aside>` 260px 縦 vs `<div>` h-10 横タブ）は本質的に別物。

実質は jscpd の html トークナイザによる誤検知。ただし 1 点だけ実際の重複がある:
両者が `isUnread` を `useSessions` から個別に import している。

→ `useSessionFilter` の戻り値に `isUnread` を含め、各レイアウトは `sessionList` 一箇所から
   受け取るようにする。これで import が 1 本減る。
   **これで alert が消えなければ、コードを歪めてまで消しには行かず「意図的な非問題」として報告する。**

## B. `server/` ↔ `src/` の手写しコピーを `common/` へ

| 対象 | 移動先 | 備考 |
| --- | --- | --- |
| `firebaseConfig` | `common/firebaseConfig.ts` | 完全同一。両側の「ミラーが慣習」コメントを削除 |
| `Shortcut` / `ShortcutKind` / `SHORTCUT_KINDS` / `sameShortcut` | `common/shortcuts.ts` | 型もヘルパも同一。MulmoClaude との on-disk 契約のコメントは `common/` 側に集約 |
| `LaunchProviderOption` / `LaunchOptions` | `common/launchOptions.ts` | クライアント側はコメントを削っただけの同型 |
| `GitStatus` | `common/gitStatus.ts` | interface 同一 |
| `RepoIssues` / `IssueItem` | `common/ghItems.ts` | `server/git/issues.ts` ↔ `PrsOverlay.vue` |
| `DirChrome` 派生の wire 形状 | 既存 `common/dirChrome.ts` を拡張 | `colors` の型のみ意図的に違う (`Partial<ITheme>` vs `Record<string,string>`) ので**共有するのは共通フィールドだけ**。ジェネリックで `colors` を差し替える |

`common/` は `types: ["node"]` にも `["vite/client"]` にも依存しない純粋な TS のみ置ける。
`ITheme` (xterm) や express の型を `common/` に持ち込まないこと。

## C. あわせて直す

- `firebase.ts` / `firebaseConfig.ts` の誤った「ミラーするのが慣習」コメントを削除
- `CLAUDE.md` に「server と src で共有する値・型は `common/` に置く」を追記し、再発を止める

## スコープ外

- `isRecord` の 28 ファイル重複定義（差分が大きいので別 PR）
- jscpd min-tokens 30 で出る同一レイヤ内 33 件・同一ファイル内 20 件

## 検証

1. `yarn format` / `yarn lint`
2. `yarn build` / `yarn typecheck` / `yarn typecheck:server` / `yarn typecheck:test`
3. `yarn test`
4. jscpd をローカルで CI と同じ条件（min-tokens 50）で流し、clone 数が減っていること
5. 拡張子リストは**リファクタ前後で集合が完全一致する**ことをテストで固定する
   （単なる移動ではなく、意図的な差分が事故で消えていないことの回帰テスト）
