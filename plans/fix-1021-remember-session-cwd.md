# 再起動を生き延びたセッションの cwd を覚える

Issue: #1021

## 症状

スマホのセッション一覧で、tmux にだけ残っているセッション（サーバ再起動を生き延びたもの）は
`cwd` が空で、#1014 で足した `work`（取り組んでいる issue / PR）も付かない。

## 原因

サーバが cwd を覚えていない。`detailOf` は `ptys.get(id)?.cwd ?? ""` で、`ptys` はこのプロセスが
spawn した PTY の表。永続化しているのは **ID だけ**（`dev-terminal-sessions.json` は 1 行 1 ID の
追記ログ）で、`KnownSession` も `{ createdAt, title }`。

## 直し方

**記録するときに cwd も残す。** `markDevTerminalSession()` の呼び出し元（`ws-routes.ts`）は
すぐ隣で `wsConnectionContext(req)` から cwd を受け取っているので、渡すだけ。

### 既存ファイルは触らない（重要）

`dev-terminal-sessions.json` は**複数バージョンが共有する追記専用ファイル**。形式を
`[{id, cwd}]` に変えると古い版のパーサが文字列以外を落とし、古い版から見てグリッドの
セッションが 0 件になる = このファイルが防いでいる「グリッドの transcript がチャットに漏れる」
状態そのものになる（#966 と同じ種類の罠）。

**cwd は別ファイル `dev-terminal-cwds.json`** に、同じ追記ログ形式で持つ。古い版は知らない
ファイルを無視し、新しい版だけが読む。移行コードは不要。

## 変更

1. `server/session/dev-terminal-cwds.ts`（新規）— 1 行 1 レコードの追記ログの読み書き。
   純関数（parse / line 生成）を分けて単体テストする。同じ id が複数行あるときは**最後が勝つ**
   （同じセルが別ディレクトリで作り直された場合、新しいほうが正しい）。
2. `registry.ts` — `markDevTerminalSession(id, cwd)` に cwd を足し、ログに追記。boot で
   hydrate して `sessionCwd(id)` で引けるようにする。
3. `ws-routes.ts` の 3 か所の呼び出しに cwd を渡す。
4. `server/index.ts` の `detailOf` — `ptys.get(id)?.cwd ?? sessionCwd(id) ?? ""`。
   **live が優先**（PTY の cwd が真実。reattach で ?cwd= を無視するのと同じ理由）。
   `workByCwd` に渡す cwd も同じ経路になるので、work も自然に付く。

## テスト

- パーサ: 1 行 1 レコード / 壊れた行を捨てる / 同じ id は最後が勝つ / 空ファイル
- 追記行: 改行が**先頭**（既存ファイルの末尾に welded しないため。ID 側と同じ理由）
- `sessionCwd`: 覚えていない id は null
- 一覧: live は PTY の cwd、tmux だけのセッションは覚えた cwd、どちらも無ければ空
- **古い版が読めること**: ID のファイルは形式が変わっていない（このファイルに触っていないことを
  spec で固定する意味は薄いので、代わりに「cwd ログのパーサは ID ログを読まない」を確認）
