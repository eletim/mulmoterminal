# docs: ファイルパスのクリック挙動を記録し、乖離の再発を止める

Issue: #834 / 対象機能: #808, #809, #810, #811（1.11.0）

## 問題

クリック時のルーティングが「拡張子ごとに開き方を変える」形に変わったのに、`docs/ChangeLog.md`
以外に書かれていない。そのうえ既存の3箇所が**古い記述のまま残っている** — 読んだ人が誤った
仕様を信じる状態なので、単なる不足ではなく誤りとして扱う。

| 場所 | 古い記述 |
|---|---|
| `docs/guide/{en,ja}/features.md` | 「画像・GIF・動画・PDF などを新しいタブでプレビュー」 |
| `docs/terminal-notes.md` Links 表 | 「opens `/api/files/raw` preview」 |
| `src/composables/terminalFilePathLinkProvider.ts` 先頭 | 「open the file in a new browser tab (via the raw-file route)」 |

## 実際のルーティング（`terminalFilePathLinkProvider.ts`）

| 拡張子 | 開き方 |
|---|---|
| `.md` `.markdown` | `/api/files/browse/md` — レンダリング済み、新しいタブ |
| `.json` | `/api/files/browse/json` — 整形 |
| `.csv` `.tsv` | `/api/files/browse/table` — 表 |
| `SOURCE_CODE_EXTENSIONS`(45) + `.txt` | アプリ内 **Files ビュー**（新しいタブを開かない） |
| それ以外（画像・PDF・SVG・HTML・動画） | `/api/files/raw` — 新しいタブ |

## 方針：terminal-notes.md にまとめない

`docs/terminal-notes.md` は xterm / node-pty / tmux の4層と「依存を上げたら何を再確認するか」が
主題。拡張子 → ビューアのルーティングはサーバのルートと Vue のビューにあり、xterm や tmux を
上げても壊れない。まとめるとアップグレード回帰チェックリストという役割が薄まる。
ただし Links 表の1行は事実として古いので**訂正はする**（詳細は README へリンク）。

## やること

1. `README.md` — 「Inserting a file path」の直後に「Clicking a file path」と対応表を追加。
   ここが正典。意図的な非対称は `test/common/sourceExtensions.spec.ts` がピン留めしている旨も書く
2. `docs/guide/{en,ja}/features.md` — 該当行を書き直す（両言語同期）
3. `docs/terminal-notes.md` — Links 表を訂正し、README へリンク
4. ソース側に更新義務を書く（同じ乖離を再発させないため）
   - `terminalFilePathLinkProvider.ts` — 古い先頭コメントを直し、ルーティングを変えたら更新する
     ドキュメントを列挙
   - `common/sourceExtensions.ts` — 拡張子を足す側の入口なので同じポインタ
   - `useTerminalConnections.ts` — ターミナル全般の仕様変更時に見るドキュメントを示す

## 検証

ドキュメント変更のみでコードの挙動は変えないため、既存テストが通ることの確認に留める
（`yarn format` / `lint` / `typecheck` / `build` / `test`）。表の内容は
`terminalFilePathLinkProvider.ts` の `ROUTE_BY_EXTENSION` / `IN_APP_EXTENSIONS` と
`common/sourceExtensions.ts`（45件）に突き合わせて確認済み。
