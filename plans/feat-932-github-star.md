# feat: グリッドヘッダーに GitHub star ボタン (#932)

## 目的

グリッドヘッダーからワンクリックで `receptron/mulmoterminal` にスターを付けられるようにする。

設計の中心は機能ではなく**引き際**にある。自分の作業画面に作者の宣伝が常駐するのは嫌われるので、
一度スターしたら（あるいは一度リポジトリページを開いたら）ボタンごと消えることを最優先で満たす。
単なる外部リンクではなく実 star API を使うのは、リンクだけでは「押したかどうか」が永久にわからず、
ボタンを消す判断ができないため。

## 設計

### 状態の三値

`starred: boolean | null` の三値で扱う。`null` は「判定不能」= `gh` 未インストール / 未ログイン /
オフライン。この三つを区別せず false に潰すと、gh の無いユーザーに押しても何も起きないボタンを
見せることになるので、null は「リンクとして振る舞う」に割り当てる。

| starred | ボタン | クリック |
| --- | --- | --- |
| `true` | 出さない | — |
| `false` | 出す | `POST /api/github/star` → 成功で消える |
| `null` | 出す | リポジトリページを新規タブで開き、以後は出さない |

### レイヤ

- `common/githubRepo.ts`
  サーバ（gh の API パス組み立て）とクライアント（フォールバック URL）が同じ `owner/repo` から
  判断するので `common/`。片側に置いて mirror しない。

- `server/git/github-star.ts`
  既存の `runGh()` を使う。`gh` の終了コードと stderr の解釈は**純関数** `interpretStarCheck()` に
  切り出し、spawn なしでユニットテストする。
  - 確認: `gh api /user/starred/<repo>` → 204/exit 0 なら starred、404 なら未スター、それ以外は null
  - 付与: `gh api -X PUT /user/starred/<repo>`
  - 起動中はメモリキャッシュ。`starred=true` は覆らないので確定させ、gh の spawn を最小化する

- `server/routes/repo-routes.ts` に相乗り（既に `gh` 前提の cross-repo ルートが居る場所）
  - `GET /api/github/star` → `{ starred: boolean | null }`
  - `POST /api/github/star` → `{ starred: boolean }`
  POST は `app.use(sameOriginGuard(...))` のグローバルゲートで既に保護される（per-route ガード不要）。

- `src/composables/useGithubStar.ts`
  localStorage に「対応済み」フラグ。フラグが立っていればサーバ問い合わせ自体を行わない
  （スター済みユーザーの起動コストをゼロにする）。

- `src/components/AppToolbar.vue`
  右側クラスタ（ベル / Update / サウンド / 設定）に `v-if="inGrid && ..."` で追加。
  左の `nav` はビュー切り替え専用なので入れない。アイコンは Material Symbols の `star`。

## やらないこと

- スター数の表示 — API 呼び出しが増え、数字が小さいと逆効果
- 単一ビュー（Chat）側への表示 — 今回はグリッド限定
- 設定モーダルのオン/オフ項目 — スター済み・dismiss 済みで消えるので設定項目は不要

## MulmoClaude との関係

`../mulmoclaude` に対応物なし（star 関連のコードは無い）。よって API パスを合わせるべき先例は
存在せず、こちらが先例になる。CLAUDE.md の「MulmoClaude is the reference host」に従い確認済み。

## テスト

- `test/server/git/github-star.spec.ts` — `interpretStarCheck()` の三値分岐
  （exit 0 / 404 / gh not found / auth 失敗 / ネットワーク失敗 / stderr 空）
- `test/common/githubRepo.spec.ts` — URL と API パスが一つの定数から導かれること、
  `parseStarState()` が壊れた body を「判定不能」に潰すこと
- `test/src/composables/useGithubStar.spec.ts` — 三値それぞれの表示、スター済みなら
  問い合わせ自体を行わないこと、クリック後の確認表示 → 引退、POST 失敗時のリンク降格

## 手動確認

`~/.mulmoterminal` を汚さないよう `HOME` を捨て `GH_TOKEN` だけ本物にした隔離サーバ
（`PORT=34599`）で確認した。

- `GET /api/github/star` → 認証済み `gh` で `{"starred":false}`、認証なしで `{"starred":null}`
- 実際の `gh api /user/starred/receptron/mulmoterminal` は stderr に `gh: Not Found (HTTP 404)`、
  exit 1 — `interpretStarCheck` の前提どおり
- 別オリジンからの `POST /api/github/star` → 403（グローバル same-origin ゲートが効いている）

`POST` の成功パスは実際に叩いていない（本物のアカウントにスターが付くため）。ユニットテストと
`gh` の挙動確認までで、実クリックは未検証。
