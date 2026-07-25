# fix(remote-host): 購読の永久停止からの自動復帰と、切れたことの可視化

issue: #823

## 背景

放置するとスマホからホスト（Mac）に繋がらなくなり、Mac 側には何の表示も出ない。
原因は Firebase のログイン失効ではなく、`@mulmoclaude/core@1.3.0` の
`startHostRunner` が Firestore の購読を**永久に諦める**こと。

- fatal 判定（transient セット以外＝`unauthenticated` / `permission-denied` 等）は
  リトライ 0 回で `goOffline()`
- transient でもリトライは 5 回・約 31 秒で打ち切り、`attempt` は snapshot 成功時しか
  リセットされない
- `goOffline()` は heartbeat を止め presence に `online:false` を書く。auth には
  触らないので `status()` は `{ connected: false, uid: <生きた uid> }` を返す

気づけない理由は、Mac 側の唯一の信号がサーバログ 1 行であること、UI が status を
定期取得していないこと、実際のエラーコードがどこにも残らないこと（mulmoterminal の
`log.debug` は握り潰し、core は `event.message` を捨てる）。

## 方針

core を変更せずに直せる。mulmoterminal は `startRunner` を握っているので、
`startHostRunner` を**自己再購読ラッパ**で包み、core の `onClosed` を横取りできる。

### 0. 診断ログ

`options.onEvent` をラップし、`phase === "error"` を message 込みで warn。
次に落ちたときに `unauthenticated`（トークン）か `unavailable`（ネットワーク）かが
確定し、core 側 issue の内容も正確に決まる。

### 1. 自動復帰（server/backends/remoteHost/resilientRunner.ts）

core の runner が諦めたら、こちらが張り直す。

- バックオフ: `min(60s, 1s * 2^attempt)`
- **打ち切りは回数ではなく時間**（core のバグの再演を避ける）。最初の切断から
  `GIVE_UP_MS = 5分` 粘っても復帰しなければ諦め、`options.onClosed?.()` を上げる
  → core が disconnected にし、クライアントが parked blob で完全な再認証に
  エスカレーションする（トークン失効はこの経路でしか直せない）
- 「復帰した」の判定: 張り直した runner が `SETTLE_MS = 60秒` 無事に生き延びたら
  online に戻す。core の runner は transient 失敗を内部で約 31 秒リトライしてから
  `onClosed` を上げるので、それより長く待たないと「生きている」と言えない
- `start()` 自体が throw する場合（切断済みで `currentFirestore()` が投げる）も
  失敗として同じ経路に流す
- タイマーと時刻は注入。テストは実時間を待たない

### 2. 可視化

- **ベル通知**: 諦めた時点で severity `urgent` を publish、復帰したら clear。
  pubsub 経由なので開いている全タブに即反映される（ポーリング不要）。
  短い瞬断では出さない（`reconnecting` では publish しない）
- **status API**: `/api/remote-host/status` の応答に `health`
  （`online` / `reconnecting` / `offline` + 最後のエラー + 遷移時刻）を追加
- **ポップオーバー**: Online / Reconnecting… / Offline と最後のエラーを表示
- **定期取得**: `registerRemoteHostSelfHeal` に 30 秒間隔の heal を追加。
  アイコン表示が固まるのと、parked blob による自動再接続が発火しないのを防ぐ

## テスト

- `resilientRunner`: 再購読する / バックオフが伸びる / 時間で諦めて `onClosed` を
  上げる / settle 後に online に戻る / `stop()` 後は何もしない / `start()` の
  throw を失敗として扱う / listen エラーを message 込みでログする
- `healthNotice`: offline で publish、online で clear、reconnecting では出さない、
  二重 publish しない
- `remoteHostSelfHeal`: 一定間隔で heal する / cleanup で止まる
- `routes`: status 応答に health が載る

## 対象外（別リポジトリ / 別 issue）

`@mulmoclaude/core` 側の根本修正（リトライを時間ベースに、`unauthenticated` は
トークン再取得して再購読、presence 書き込みの失敗握り潰し、`onEvent` の
`event.message` 欠落）。本 PR のラッパは core が直っても無害に共存する。
