# `NODE_ENV=production` がセル内の全ターミナルに漏れる

Issue: #955

## 症状

npx で起動した MulmoTerminal のセルで `yarn install` すると devDependencies が入らない。
yarn は成功を報告するので失敗として現れず、「node_modules が壊れた」と誤診される。

## 原因（検証済み）

1. `bin/mulmoterminal.js:275` — launcher がサーバを `NODE_ENV: "production"` で spawn する。
2. `server/session/pty-spawn.ts:36` — PTY の env は `sanitizePtyEnv(process.env, …)`。落とすのは
   launcher 由来と分かっている名前（`server/infra/pty-env.ts` の `REMOVED_NAMES`）だけで、
   `NODE_ENV` は入っていない。結果、セルの全ターミナルが `NODE_ENV=production` を持つ。
3. yarn 1.22.22 (`lib/cli.js`) は
   `production = getOption('production') || NODE_ENV === 'production' && NPM_CONFIG_PRODUCTION !== 'false' && YARN_PRODUCTION !== 'false'`
   と決めるので devDependencies を飛ばす。

`yarn dev` は launcher を通らないので再現しない。npm 11 は install の省略に `NODE_ENV` を見ない。

## 採る解（issue のアプローチ 1）

**発生源を断つ**。launcher が `NODE_ENV` を渡すのをやめる。

アプローチ 2（`sanitizePtyEnv` で落とす）は採らない。`test/server/infra/pty-env.spec.ts` の
"keeps real user environment" が `NODE_ENV` を**残すべき変数**として assert しており、
サニタイザは「NODE_ENV はユーザー由来」という前提で設計されている。落とすと、自分で
`NODE_ENV` を export しているユーザーの環境まで壊す。

## `NODE_ENV=production` を消して失うもの

リポジトリ内に `NODE_ENV` を読む箇所は無い（書くのは launcher の 1 行だけ）。実際の消費者は
express 5 だけで、影響は 1 つ:

- `express/lib/application.js` が `process.env.NODE_ENV || 'development'` を `env` 設定に入れ、
  `application.js:154-155` がそれを finalhandler に渡す。`finalhandler/index.js:160` は
  `env !== 'production'` のときエラー応答に**スタックトレースを載せる**。
- view cache も production 依存だが、このアプリはビューを使わないので無関係。

なので消すだけでは、npx 起動時に今まで隠れていたスタックトレースが HTTP 応答に出るようになる
（`yarn dev` では今も出ている）。これを環境変数から切り離して固定する。

## 変更

1. **`bin/cli-args.js` に `serverSpawnEnv(env, port, cwd)` を足す** — `{ ...env, PORT, CLAUDE_CWD }`。
   `NODE_ENV` を入れない理由をここに書く。このファイルの役割（launcher の判断を実行ファイルの外に
   出して検査可能にする）にそのまま乗る。`bin/cli-args.d.ts` に型を追加。
2. **`bin/mulmoterminal.js`** — spawn の `env:` をこの関数の呼び出しに置き換える。
3. **`server/infra/hide-error-stacks.ts`（新規）** — `hideErrorStacks(app)` が `app.set("env", "production")`
   する。`server/index.ts` の `const app = express()` 直後で呼ぶ。これで起動経路によらず
   スタックトレースは応答に出ない。

## テスト

- `test/bin/server-spawn-env.spec.ts`
  - `NODE_ENV` を注入しない（親に無ければ子にも無い）
  - ユーザー自身の `NODE_ENV` は production/development のどちらもそのまま通す
  - `PORT` は文字列、`CLAUDE_CWD` が入る
  - 入力の env を破壊しない
  - 回帰の芯: 返り値のキーに `NODE_ENV` が現れない（#955）
- `test/server/infra/hide-error-stacks.spec.ts`（supertest）
  - throw するルートの 500 応答にスタックが出ない — `NODE_ENV` 未設定でも、`development` でも
  - `app.get("env") === "production"`
- `test/server/infra/pty-env.spec.ts` — 既存の "keeps real user environment" に、なぜ `NODE_ENV` を
  ここで落とさないのか（#955 は発生源を断って直した）をコメントで残す。

## ドキュメント

README / docs に `NODE_ENV` の記述は無いので更新なし。changelog はリリース時（`/publish`）。
