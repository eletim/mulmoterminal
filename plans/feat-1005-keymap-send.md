# feat(keymap): ターミナルへ任意のキー列を送信する (#1005)

## 要望

Mac で `Cmd+→` / `Cmd+←` を行末・行頭へ。`keymap`（#829）で割り当てられる先が**アプリのアクション**
だけで、**ターミナルへ生のバイト列を送る**口が無かった。

## issue の設定例は使えなかった — 向きが逆

`keymap` は **`action -> key`**（キーが閉じた enum のアクション名、値は文字列 1 個）。issue の提案は
**`key -> payload`**。今の形では **1 アクション 1 バインド**しか書けず、キーごとに違うペイロードを
持たせる余地が無い。

採用した形（相談のうえ決定）— **`keymap` ブロックを 1 つに保つ**方を採った。コードに
「キーを割り当てる場所を `keymap` 1 つに保つ」という方針が明記されているため（`TERMINAL_SCOPED_ACTIONS`
のコメント）。

```json
{ "keymap": { "send": [{ "key": "Cmd+ArrowRight", "bytes": "\u0005" },
                       { "key": "Cmd+ArrowLeft",  "bytes": "\u0001" }] } }
```

代償は `Keymap` 型が混合（`Partial<Record<KeymapAction, string>> & { send?: SendBinding[] }`）に
なること。`KEYMAP_ACTIONS` には**入れていない** — 入れると値の型が壊れ、`keymapLabels` の
「全件 Record」による網羅チェックも壊れる。

## 実装場所は既存の前例で決まった

ディスパッチは 2 経路ある。

| 経路 | 場所 | 可否 |
|---|---|---|
| グリッド | `GridView.vue` の `onShortcutKey` | **不可**。全マッチで `preventDefault()` するため `copy`/`paste` を明示的に拒否している |
| ターミナル | `useTerminalConnections.ts` の `attachCustomKeyEventHandler` | **ここ**。WS への `send(data)` を持ち、どの PTY かも分かる |

`makeEnterHandler` が**既に「キー→任意のバイト列」そのもの**なので、`makeSendHandler` を同じ 3 行で
書いた。`preventDefault()` が必須な理由も同じ — 無いと xterm がブラウザに keypress を撃たせ、
それが余計な入力になる。

ハンドラ内の順序は **clipboard → send → Enter**。両方に割り当てたときだけ効く順序で、より
限定的な方が勝つようにしてある（copy/paste は最大 2 キー、Enter への `send` はその 1 キーの
submit 挙動を意図的に上書きしたということ）。

## 衝突は「引き分け」ではない — アクションが必ず勝つ

グリッドのハンドラは **`window` の capture フェーズ**で、マッチすると `stopPropagation()` する。
つまりイベントはターミナルの xterm に**届かない**。同じキーにアクションと `send` を書くと、
`send` は黙って発火しない。

これは調べないと分からないので、`validateKeymap` が**どちらが勝つかを名指しして警告**する。
`duplicateWarnings` を rank ベースに変え、アクションは `KEYMAP_ACTIONS` 内の位置、`send[i]` は
`KEYMAP_ACTIONS.length + i` という順位を持たせた。設定ファイル内の記述順ではなく**実際の
ディスパッチ順**で勝者を決めるのは元の実装の方針そのままで、そうしないと嘘を報告する。

## fatal にした判断

`send` 周りは**すべて fatal**（サーバが起動しない）。モジュール冒頭の理由と同じで、ショートカットは
押すまで見えないため、黙って落とすと「効かないショートカット」と区別が付かない。

`"bytes": ""` も fatal。**キーをターミナルから奪っておいて何も送らない**ことになり、
「このキーが壊れた」と読める — 未割り当てより悪い。

## 設定画面

`keymapLabels.ts` のコメント「新しいショートカットが、それを知らせる唯一の画面に出ないまま
出荷されてはいけない」に従い、`send` も一覧に出す。制御文字は字が無いので**キャレット記法**
（`^E`）で描く — 生で出すと不可視の行になる。

## テスト

- `test/common/keymapSend.spec.ts`（25 本）— マッチ規則、バリデーション、sanitize、**衝突時の勝者**
- `test/src/composables/useTerminalConnections.spec.ts` に 4 本追加 — 送信・`preventDefault`・
  未割り当ての素通し・**キーマップを毎回読み直す**こと（設定はリロード無しで変わる）

ドキュメントの JSON 例 3 件（EN / JA ガイド、SKILL）は**実バリデータに通して確認**した。
不正な `keymap` サンプルは読者のサーバ起動を止めるため。

## 未検証 — 実機

**`Cmd+→` がページに届き `preventDefault` で抑えられるか**はヘッドレスで確かめられない。
macOS では `Cmd+←/→` は履歴の戻る/進むで、`Cmd+W` のような予約ショートカットではないので
止まるはずだが、**これは issue の前提そのもの**。実機で確認が要る。
