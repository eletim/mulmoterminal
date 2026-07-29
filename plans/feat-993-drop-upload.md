# feat(#993): パスが取れないドロップは、保存してそのパスを渡す

ブラウザが実パスを渡さないとき（Chrome、そしてリモートから開いているとき全部）、ドロップは
今ヒントを出して終わっている。そこを「中身をホストに保存して、そのパスを挿入する」に差し替える。

## 決定（#993 のコメントに記録済み）

| # | 決めること | 決定 |
| --- | --- | --- |
| 1 | 保存先 | OS の tmp（`os.tmpdir()`） |
| 2 | cwd 外パスの読み取り | セッション専用 tmp を `--add-dir` |
| 3 | 寿命 | セッション終了時に削除（＋起動時の孤児掃除） |
| 4 | 優先順位 | パス優先、取れないときだけアップロード |
| 5 | ドロップ先 | ターミナル本体のみ |
| 6 | サイズ上限 | 専用 binary 経路で 110MiB |
| 7 | パスの決定権 | サーバが全部決める（UUID ファイル名） |

## 既存パターンに乗る — 発明しない

決定 2 と 3 は、どちらもこのリポジトリに**同じ形の先例がある**。新しい仕組みは作らない。

**決定 3（寿命）→ `session-settings.ts` の二段構え**をそのまま写す。

| 役割 | 先例 | ここで作るもの |
| --- | --- | --- |
| セッション終了時に消す | `cleanupSessionSettings(id)` を `reap()` から呼ぶ（`lifecycle.ts:163`） | `cleanupSessionDrops(id)` を同じ場所から |
| 起動時に孤児を消す | `pruneOrphanSettings(liveIds)`（`index.ts:748`）。生き残った tmux セッションの id 集合と突き合わせる | `pruneOrphanDrops(liveIds)` を隣で |
| 消す操作 | `removeQuietly()`（`infra/fs-cleanup.ts`）。Windows のロックで teardown を壊さない | 同じものを使う |
| 名前からの id 復元 | `sessionIdFromFileName()` — **ディレクトリが自分のものでも、自分が書いたと確認できないものは消さない** | ディレクトリ名を `SESSION_ID_RE` で検証してから消す |

**決定 2（add-dir）→ 既存の `addDirs` 経路に足すだけ。** 今は per-directory 設定から来ている
（`spawn-claude.ts:119` の `addDirs: dir.addDirs`）。ここにセッション専用 tmp を足す。
サンドボックスは `sandbox.ts:364` が `--add-dir` のパスを同じ絶対パスで bind-mount するので
**追加作業なし**。

## 実装

### 1. `server/session/session-drops.ts`（新規）

`session-settings.ts` と同じ構成。純粋な部分と I/O を分ける。

```
DROPS_ROOT      = path.join(os.tmpdir(), "mulmoterminal-drops")
dropsDir(id)    = path.join(DROPS_ROOT, id)          // id は SESSION_ID_RE
saveDrop(id, bytes, mimeType) -> { absPath }         // <dir>/<uuid><ext>
cleanupSessionDrops(id)                              // reap() から
pruneOrphanDrops(liveIds) -> string[]                // 起動時、落とした id を返す
```

- **拡張子は `attachment-path.ts` の `extensionForMime` を再利用する。** MIME→拡張子の表を
  二重に持たない（DRY）。未知は `.bin`
- **書き込みは temp + rename**（`attachmentStore.ts` と同じ）。中途半端なファイルのパスを
  ターミナルに挿してしまわないため
- ディレクトリは `mode: 0o700`。tmp は共有ディレクトリなので、他ユーザーに読ませない

### 2. `--add-dir` にセッション tmp を足す

`spawn-claude.ts:119` の `addDirs: dir.addDirs` を `[...(dir.addDirs ?? []), dropsDir(sessionId)]` に。
ディレクトリは spawn 前に作る（存在しないパスを `--add-dir` に渡すと、サンドボックスの
`-v` が空ディレクトリを掘るなど OS 差が出るため）。

**サンドボックス経路も同じ値を渡す**（`spawn-claude.ts:155` の `spawnSandboxEntry(..., dir.addDirs)`）
— ここが今 `dir.addDirs` を直接渡しているので、同じ配列を使うよう 1 か所にまとめる。

### 3. アップロード経路 `POST /api/session/:id/drop`（新規）

決定 6 のため **`express.json` に載せない**。`express.raw({ type: "*/*", limit: "110mb" })` を
このルートにだけ適用する。

- MIME は `Content-Type`、元ファイル名は `X-Drop-Filename`（**表示・拡張子推定にのみ使い、
  パスには一切使わない** — 決定 7）
- `:id` は `SESSION_ID_RE` で検証し、`ptys` に居るセッションのみ受ける
- 書き込み系なので中央の same-origin ゲートを自動で通る（`same-origin-guard.ts:36`）
- 返すのは `{ path }`（絶対パス）だけ

### 4. `Terminal.vue` の `onDrop`

```
パスが取れた            -> 今までどおり insertText（決定 4）
取れない & File がある  -> アップロード -> 返ってきたパスを toShellArg して insertText
取れない & File もない  -> 今までどおりヒント
```

`dropPaths.ts` は純粋なまま据え置き、`toShellArg` を再利用する。アップロード中は既存の
`dragOver` とは別のフラグで進行を出す（大きいファイルで無反応に見えないため）。

**エラーは黙らせない。** 413 / 403 / ネットワーク断は、既存のヒント表示の仕組み
（`showDropHint`、翻訳つき）にメッセージを流す。

## テスト（`test/` に Vitest）

純粋部分を関数に切ってあるので、ディスクを触らずに書ける。

- `dropsDir` が `SESSION_ID_RE` を満たさない id を**拒否する**（`../` を含む id で確認）
- `pruneOrphanDrops` が **生きている id を残し、孤児だけ落とす**
- `pruneOrphanDrops` が **自分が書いた形でないディレクトリ名を無視する**（tmp は共有なので、
  ここを落とすと他人のディレクトリを消しうる — 一番危ないケース）
- `extensionForMime` の再利用が効いていること（`image/heic` → `.heic`、未知 → `.bin`）
- 上限を超えた本文が 413 になること
- `Terminal.vue` の分岐は `dropPaths` の純粋関数側で担保（パスあり／なし）

## 確認すること（レビュー時）

- **既に起動しているセッションでは許可プロンプトが残る。** `--add-dir` は spawn 時にしか
  渡せないので、新規セッションから効く。これは決定 2 の既知の代償
- **tmp は共有ディレクトリ。** `pruneOrphanDrops` が消してよいものだけ消すか
- **`X-Drop-Filename` を保存パスに使っていないか**（決定 7 の要）

## やらないこと

- Files ペインへのドロップ（決定 5）
- 常時アップロード（決定 4 — パスが取れるときは今までどおり）
- スマホ側 UI（`receptron/mulmoserver`）。ホスト側の経路は #1026 段階 4 の話
