# どのセルがどの PR / issue を進めているかをヘッダーに出す

Issue: #979

## 分割

- **Phase 1（この計画）— 表示。** ヘッダーに `#977 → #966` とフェーズを出し、マージで即消す。
  GitHub に書き込まない、読み取りだけの変更。
- **Phase 2 — コメント自動化。** 作業中 / マージ完了コメントと close、opt-in 設定、手動ボタン。
  GitHub に**書き込む**ので、レビューを分ける。

## Phase 1 でやること

### すでにあるもの

`server/git/prPhase.ts` が cwd + ブランチ → PR のフェーズ（`none / draft / ci-failing /
changes-requested / ci-running / ready / merged / closed`）と URL を、`(repo, branch)` の TTL
キャッシュ付きで返す。`GET /api/pr-phase` で公開され、コックピットのロスターだけが読んでいる。

足りないのは「PR 番号」「issue 番号」「セルのヘッダーでの表示」。

### 1. 型を common に移す（先に済ませる）

`src/components/rosterPhase.ts` の先頭に **「mirror server/git/prPhase.ts's PrPhase — keep them
in sync」** と書かれている。CLAUDE.md が名指しで禁じている二重管理で、これから `/api/pr-phase`
の返り値を広げる以上、広げる前に潰す。

`common/prPhase.ts` に `PrPhase` / `isPrPhase` / ワイヤ型 `WorkItem` を置き、server と src の
両方がそこを読む。`rosterPhase.ts` に残るのは表示（色・ラベル）だけ。

### 2. PR 番号と issue 番号を解決する（純関数 + gh）

- `gh pr list --json` に `number,body` を足す
- `issueRefFromPrBody(body)`: GitHub のクローズキーワード（`close(s|d)` / `fix(es|ed)` /
  `resolve(s|d)`）+ `#N` を拾う。最初の 1 件
- `issueNumberFromBranch(branch)`: `fix/966-...` → 966。**`<type>/<数字>-` の形に限る** —
  `chore/dep-updates-20260728` を `#20260728` と読むのが現実に起きるため
- ブランチ由来の番号は**実在確認してから**使う（`gh issue view`、同じ TTL キャッシュに載せる）。
  PR 本文由来は PR の作者が書いた参照なので、そのまま信じる

### 3. ワイヤ型

```ts
type WorkItem = { phase: PrPhase; pr: number | null; prUrl: string | null; issue: number | null; issueUrl: string | null };
```

`phase` と `url` は既存キーのまま残す（ロスターが読んでいる）。

### 4. ヘッダーの chip

`BUILTIN_CHIPS` に `work` を追加。`#977 → #966` を出し、それぞれリンク。フェーズの色は
ロスターと同じ `phaseDisplay` を使う。**出さない条件**: PR も issue も無い / `merged`（即クリア）。

データは cwd 単位の共有キャッシュ付き composable（`useWorkItem`）から取る。`useDirConfig` の
per-cwd キャッシュと同じ作り。

## テスト

- `issueRefFromPrBody`: 各キーワード / 大文字小文字 / 複数あれば先頭 / `#` 無し / 本文が空 /
  URL 形式（`https://github.com/o/r/issues/12`）は拾わない（別 repo を指しうるため）
- `issueNumberFromBranch`: `fix/966-x` → 966 / `feat/910-phase3` → 910 / **`chore/dep-updates-20260728`
  → null**（回帰の芯）/ `main` → null / `fix/x-966` → null / 先頭 0 は不可
- `phaseForRepoBranch`: PR 本文の参照が勝つ / 無ければブランチ由来 / ブランチ由来で issue が
  実在しなければ null / gh 失敗時は今までどおり `none` でキャッシュしない
- chip: 表示条件（両方 null で非表示、merged で非表示）、リンク先、フェーズ色

## ドキュメント

`README.md` の chips 表と `docs/guide/{en,ja}/config.md` の chips 節に `work` を追加。
