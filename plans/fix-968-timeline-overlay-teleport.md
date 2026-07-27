# fix: 履歴モーダルがセルの矩形に閉じ込められる (#968)

## 検証

報告の診断をコードで確認した。3 つとも一致:

| | |
|---|---|
| `TimelineOverlay.vue:99` | ルートが `fixed inset-0` |
| `TerminalCell.vue:1133` | そのセルの中に直接描かれている（Teleport なし） |
| `TerminalGrid.vue:710-711` | `.stage:not(.zoomed) .grid > .focused { transform: scale(var(--focus-zoom)); }` |

**transform を持つ祖先は `position: fixed` の containing block になる**ので、基準がビューポートから
セルに変わる。セルは `overflow: hidden` なので、はみ出す分は切られる。

履歴ボタンはセルのヘッダにあり、押した時点で focusin により当のセルがフォーカス済みになる。
つまり**通常の操作手順で必ずこの状態に入る**。

## 報告で未確認だった `FilesOverlay` は影響なし

`src/App.vue:405` で `GridView`（`:312`）の**兄弟**として描かれている。セルの中ではないので
transform を持つ祖先がない。同じ `fixed` でも条件が違う。

セルの中に描かれている `fixed` のオーバーレイは `TimelineOverlay` だけ
（`CommandCell` / `LauncherCell` にはない）。

## 直し方

`TimelineOverlay` のルートを `<Teleport to="body">` で出す。

**使用側（TerminalCell）ではなく定義側（TimelineOverlay）に置く。** どこから使っても正しく
なるほうが、使用箇所ごとに Teleport を書くより壊れにくい。スタイルは Tailwind ユーティリティ
なので、DOM 位置が変わっても効き方は変わらない（scoped CSS のフラグメントルート問題も無関係）。

## テスト

- 単体: Teleport 先が body であることを固定する。`shallow: false` でマウントし、
  モーダルが**コンポーネントの DOM ツリーの外**に出ることを見る
- 実測: 報告と同じ手順で、フォーカス中のセルから履歴を開き `getBoundingClientRect()` を取る。
  修正前はセル矩形にクランプ、修正後はビューポート全体になるはず

## 実アプリでの計測

履歴ボタンは Claude セッション限定（`TerminalCell.vue:1272` の `v-if="sessionId && agent !== 'codex'"`）
なので、zsh セルでは押せない。実セッションを使う代わりに、**報告と同じ計測を実アプリの DOM で**
行った — 実行中のグリッドでセルをフォーカスし、`fixed inset-0` の要素をセルの中と body の
それぞれに挿して矩形を測る。ビューポートは 800x600:

| 配置 | 矩形 |
|---|---|
| フォーカス中セルの中（＝修正前の構造） | `x:398 y:48 w:387 h:544` — セルにクランプ |
| body（＝修正後の構造） | `x:0 y:0 w:800 h:600` — ビューポート全体 |

そのときのセル: `transform: matrix(1.03, 0, 0, 1.03, 0, 0)` / `overflow: hidden`。
報告の表（`scale(1.03)` でクランプ）と一致する。

## spec の変更が大きくなった理由

Teleport でコンテンツが wrapper の DOM ツリーの外に出るため、既存の `w.find(...)` が全て
空振りする。document 参照に置き換え、`afterEach` で `document.body` を空にする
（teleport したノードは wrapper より長生きするので、残ると次のテストが拾う）。

回帰ガードとして「body 配下にあり、マウント先の中には無い」を見るケースを 1 本足した。
Teleport を外すと**このケースを含む複数が落ちる**ことを確認済み。
