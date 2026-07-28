# issue に「作業中」「マージした」を書く（#979 Phase 2）

Issue: #979 / Phase 1 = #983（`work` chip、表示のみ）

## 何を作るか

Phase 1 で「このセルはどの issue をやっているか」がサーバ側で解けている。それを使って、
**issue の側にも作業の状況が残る**ようにする。

1. **作業中コメント** — セルが初めてその issue に解決したとき、issue に一度だけ書く
2. **マージ完了コメント** — その PR がマージされたときに書き、issue がまだ open なら close する
3. どちらのコメントにも **作業しているディレクトリ名（basename のみ）** を入れる
4. **既定は off。config で opt-in**

## 決めたこと（本人確認済み）

- 自動化は opt-in（本人は global で on にする）
- コメントには dir 名を入れる。**フルパスは出さない**（public issue に出るため）
- Phase 1 の表示はマージで即クリア（実装済み）

## 設計

### どこが発火するか

クライアント（`useWorkItem` のポーリング）が状態遷移を見て、サーバに
**「このコメントがある状態にしてくれ」**と依頼する。`POST /api/work-comment`。

GET に副作用を持たせない（`/api/pr-phase` は読み取り専用のまま）。サーバに常駐ポーラーを
足さない。開いていないセルは書かない —— 「作業中」は人が開いているセルの話なので、それでよい。

### 二重投稿をどう防ぐか

**サーバ側で冪等にする。** クライアントは何度でも同じ依頼を投げてよい設計にする
（タブが 3 枚あれば 3 回来るし、リロードのたびに来る）。

1. プロセス内メモ `(repo, issue, kind, dir)` → 投稿済み。リロード連打の大半をここで吸収
2. メモに無ければ issue の既存コメントを見て、**不可視マーカー**があれば投稿しない
   `<!-- mulmoterminal:work:start dir=mulmoterminal5 -->`
3. どちらにも無ければ投稿する

マーカーは kind と dir を含む。別のクローンで作業したら別の行が残るほうが正しい。

### 何を書くか

```
Working on this in `mulmoterminal5`.
<!-- mulmoterminal:work:start dir=mulmoterminal5 -->
```

```
Merged in #983. Work done in `mulmoterminal5`.
<!-- mulmoterminal:work:merged dir=mulmoterminal5 -->
```

英語。アプリの UI 言語に合わせる（issue の言語は repo によって違う）。

### close

マージ時、issue が **まだ open なら**閉じる。`Fixes #N` のある PR は GitHub がマージ時に
自動で閉じるので、たいていは閉じる必要がない。open かどうかを見てから決める。

### config

`~/.mulmoterminal/config.json` に `issueWorkComments: boolean`（既定 `false`）。
既存の boolean 設定（`copyOnSelect` / `worklogEnabled` / `prWorkdirFooter`）と同じ扱いで、
sanitize / merge / 公開レスポンス / ドキュメントを通す。

## 変更

| 層 | 中身 |
| --- | --- |
| `common/workComment.ts` | マーカー文字列、コメント本文、既存コメント列からの検出。全部純関数 |
| `server/git/work-comment.ts` | `gh issue view --json comments,state` / `gh issue comment` / `gh issue close`。プロセス内メモ |
| `server/routes/dir-routes.ts` | `POST /api/work-comment { cwd, issue, kind }` |
| `server/config/app-config.ts` | `issueWorkComments` |
| `src/composables/useWorkItem.ts` | 遷移検出 → POST（設定が on のときだけ） |

## テスト

- 本文とマーカー: kind と dir で変わる / dir はフルパスでなく basename / 既存コメント列から自分のマーカーだけ検出する（別 dir・別 kind は別物）
- 冪等: メモに当たれば gh を呼ばない / マーカーがあれば投稿しない / 無ければ 1 回だけ投稿する
- close: issue が open なら閉じる / すでに closed なら閉じにいかない
- 設定 off のときルートが投稿しない（403 か `{ posted: false }`）
- 遷移検出: 初回解決で start / merged への遷移で merged / 同じ状態が続く間は再送しない

## やらないこと（Phase 3 候補）

- 手動ボタン（自動が off の人が押して投稿する）。ヘッダーのボタン機構は `run: shell|input|open`
  の 3 種で、POST する新種を足す必要があるため、別 PR にする
