# feat #873 — 通知の種類ごとに音を鳴らし分ける／プリセット音源

## 背景

音は種類を区別せず 1 種類のビープが鳴る。`useAttentionSound.ts` の `needsAttention()`
が単一の boolean を返していて、そこで種類が捨てられているため。

Push には既に種類別 ON/OFF（`pushKinds`, #850）があるのに、音には種類の概念そのものが
無い。この非対称が issue #873。

さらにユーザ要望として:

- プリセットの効果音をいくつか置きたい（音源は ownplate から）
- 通知される状態は色々あるので、**全ての状態をカスタムできる**ようにしたい
- **新規の通知状態は既定 OFF**

## 現状の通知状態は 2 つだけ

`common/pushKinds.ts` の `PUSH_KINDS` が唯一の語彙:

| kind | 発火元 | 意味 |
|---|---|---|
| `finished` | Claude `Stop` フック / Codex ターン終了 | ターンが終わり出力が未読 |
| `waiting` | Claude `Notification` フック | 許可プロンプト・質問で停止中 |

## 決めたこと（ユーザ判断）

### 音源

**ownplate（`Nakajima-Foundation/ownplate`, MIT, 自社管理リポ）の `public/sound_*.mp3` を
raw から取得し、`~/.mulmoterminal/sounds/` にキャッシュする。**

- `raw.githubusercontent.com` は `access-control-allow-origin: *` / `content-type: audio/mpeg`
  を返すので取得自体は可能。ただし `cache-control: max-age=300` しかないので、毎回取りに
  行かせない
- キャッシュはサーバ側（`~/` に書けるのはサーバだけ）。ブラウザは `/api/sound-preset/<id>`
  を叩き、サーバが未キャッシュなら取得して保存 → 以後はディスクから配信
- 取得失敗（オフライン等）は内蔵チャイムにフォールバックし、**無音にはしない**

対象 7 音（`silence.mp3` は除外）:
`sound_default` / `sound_coin` / `sound_cheep_cheep` / `sound_door_chime` / `sound_gong` /
`sound_magic` / `sound_meow`

### 通知状態（kind）

既存 2 つ + 新規 4 つ。**新規はすべて既定 OFF**（`DEFAULT_PUSH_KINDS` と同じ「後から足した
kind は opt-in」の作法）。

| kind | シグナル | 既定 |
|---|---|---|
| `finished` | 既存（サーバ hook → pub/sub） | ON |
| `waiting` | 既存（同上） | ON |
| `command-done` | Run セルの `exit` フレーム（exitCode 0） | OFF |
| `command-failed` | 同上（非ゼロ） | OFF |
| `session-exited` | pub/sub の `event: "closed"` | OFF |
| `pr-ci-failed` | `GridView` の `/api/pr-phase` ポーリング結果が `ci-failing` に遷移 | OFF |

`pr-ci-failed` の制約: PR フェーズのポーリングは**ロスターが画面に出ている間だけ**動く。
別ビューにいる間の CI 失敗は拾えない。既定 OFF なので許容し、UI のヘルプ文に書く。

`session-exited` の制約: 手動でセルを閉じた場合も同じ経路を通る。既定 OFF で、選んだ人だけ
鳴る形にする。

### 設定の形

グローバル（`~/.mulmoterminal/config.json`）:

```json
{
  "soundKinds": ["finished", "waiting"],
  "sounds": { "finished": "preset:coin", "waiting": "/abs/path/my.mp3" }
}
```

- `soundFile`（既存）は **全 kind 共通のフォールバック**として維持 — 後方互換
- `sounds[kind]` は `preset:<id>` かユーザファイルの絶対パス

ディレクトリ（`<cwd>/.mulmoterminal.json`）:

- `sound`（既存）は全 kind 共通のまま
- `sounds: { [kind]: string }` を追加して kind 別に上書き

### 解決順（kind ごと）

```
dir sounds[kind] → dir sound → global sounds[kind] → global soundFile → 内蔵チャイム(kind別)
```

内蔵チャイムも #873 A のとおり kind で鳴らし分ける（Web Audio の周波数/長さ違い。音源
ファイル不要）。

## 実装方針

### common/

- `common/notifyKinds.ts` — `NOTIFY_KINDS` / `NotifyKind` / `DEFAULT_SOUND_KINDS`。
  `PUSH_KINDS` は電話に飛ぶサブセットとして残し、`PushKind extends NotifyKind` を
  **テストで固定**する（`common/sourceExtensions.ts` + spec と同じ作法）
- `common/notifySounds.ts` — プリセットカタログ（id / ファイル名 / ラベル）と
  `preset:` 参照のパース

### server/

- `server/config/sound-presets.ts` — raw 取得 + `~/.mulmoterminal/sounds/` キャッシュ。
  `AbortController` でタイムアウト、失敗は 404 を返してクライアントをチャイムに落とす
- `GET /api/sound-preset/:id` — 上記を配信
- `app-config.ts` に `soundKinds` / `sounds` を追加（sanitize 込み）
- `dir-config.ts` に `sounds` を追加。`sound` と同じ**パス封じ込め検査**を各値に適用
- `GET /api/dir-sound?cwd=&kind=` — kind 別のディレクトリ音

### src/

- `useAttentionSound.ts` — `needsAttention()` の戻り値を `NotifyKind | null` に変更。
  kind ごとのバッファキャッシュ／解決順／kind 別チャイム
- Run セルの `exit` → `command-done` / `command-failed`
- pub/sub `closed` → `session-exited`
- `GridView` の PR フェーズポーリング → 前回値と比較して `pr-ci-failed`
- `SettingsModal` — kind ごとに「ON/OFF + プリセット選択 + 試聴」の行

### テスト

- `needsAttention` の kind 判定（finished / waiting / 初回は鳴らさない / 変化なしは鳴らさない）
- `PushKind ⊂ NotifyKind` の固定
- sanitize（未知 kind の除去、既定は新規 kind を含まない）
- 解決順（dir kind別 > dir 共通 > global kind別 > global 共通）
- プリセットキャッシュ（未キャッシュ→取得→保存、2回目はディスク、取得失敗は 404）
- PR フェーズ遷移の検出（ci-failing への遷移だけ / 同じ値の再ポーリングでは鳴らさない）

## 実装中に分かったこと

### 既存のバグ: バックグラウンドの Stop で2回鳴っていた

`server/session/activity-hook.ts` は、見ていないセルの `Stop` に対して
`{ waiting: true }` と `{ working: false }` を**別々に**適用する。publish は flag ごとなので
1回の完了ターンで**2行**流れてくる。旧 `needsAttention` は `finishedTurn || becameWaiting`
の boolean だったため、1行目を「waiting になった」、2行目を「finished した」と数え、
**同じターンで2回ビープしていた**。

さらにこの2行はフラグだけでは `Notification`（本当に質問で止まった）と区別できない。
publish には hook 名が `event` として載っているので、`notifyKindOf` はそれを見て

- `working: true→false` → `finished`
- `waiting: false→true` **かつ** `event !== "Stop"` → `waiting`

とした。結果、1ターン1回になり、鳴らし分けも成立する。issue #873 が挙げていない
既存バグなので、コミットで明示する。

### `@mulmoclaude/core` のインストールずれ

`yarn typecheck:test` が `googleCalendar.spec.ts` で落ちたが、原因は node_modules が
1.3.0 のまま（package.json は ^1.7.0）だったこと。`yarn install` で解消。テスト側の型を
いじる話ではなかった。

## 確認

- `yarn format` / `yarn lint` / `yarn typecheck` ×3 / `yarn build` / `yarn test`（4631 passed）
- 実サーバ（`PORT=34611`）に対して:
  - `/api/sound-preset/coin` 初回 397ms（取得）→ 2回目 2.6ms（ディスク）。`~/.mulmoterminal/sounds/`
    に保存され、サイズは ownplate の原本と一致
  - 未知の id は 404
  - `/api/sound?kind=finished` に `preset:magic` を設定 → 53869B（= sound_magic.mp3）を配信
  - `/api/dir-sound?cwd=&kind=` — kind 別プリセットが勝ち、未指定 kind は dir の `sound` に
    フォールバック、`../escape.mp3` は拒否されてフォールバック（封じ込め維持）
  - `{"sounds": []}` は 400（サニタイズによる暗黙の全消しを防止）
- プリセット7種と kind 別内蔵チャイム6種を実際に再生して音を確認
- **未確認**: Settings 画面の見た目（ブラウザツールが使えなかった）。PR のレビュー項目に記載
- README / `docs/guide/{en,ja}/config.md` を更新
