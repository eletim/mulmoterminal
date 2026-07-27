---
title: 設定方法
layout: default
parent: 日本語
nav_order: 4
---

# 設定方法
{: .no_toc }

- TOC
{:toc}

設定は 3 か所にあります。**設定モーダル（⚙）**・**グローバル設定 `~/.mulmoterminal/config.json`**・
**プロジェクトごとの `<project>/.mulmoterminal.json`**。ボタン/チップは両ファイルがマージされます。

{: .highlight }
> **手書きする必要はありません。** MulmoTerminal のセッションで **`/mulmoterminal-config`** と打てば、
> 同梱スキルがチェックボックスと配色プリセットで案内しながら、妥当なファイルを書いてくれます。現在の
> ディレクトリでも、最近使った複数ディレクトリまとめてでも可能です。（⚙ → **🎨 Configure appearance…**
> ボタンからも同じスキルが起動します。）
>
> **UI が一切なく `~/.mulmoterminal/config.json` にしか存在しない設定**を見つける手段でもあります——
> [`providers`](#providers)（別のモデル）・[`keymap`](#keymap)（キーボードショートカット）・
> [`terminalSubmit`](#terminal-submit)（「Shift+Enter で改行ではなく送信されてしまう」の対処）・
> [`fontFamily`](#font-family)（ターミナルのフォント）・定期 dev-work ログ。
> 手編集でも構いません（このページに全フィールドの説明があります）が、スキルは書きながら検証します。
> これは特に `keymap` で効いてきます——記法を間違えるとサーバが起動しなくなるためです。

---

## 設定モーダル（⚙）

ツールバーの ⚙ から開きます。

![設定モーダル](../images/settings.png)

| 項目 | 内容 |
|---|---|
| **THEME** | Midnight / Nord / Daylight / Solarized Light |
| **TERMINAL FONT SIZE** | ターミナル（xterm）のフォントサイズ（px, 8〜32）。**このブラウザ**の全ターミナルに適用され、スマホと PC でそれぞれ別の値を保持します。ディレクトリ側の `fontSize`（[後述](#per-dir)）が優先されます |
| **DIRECTORY APPEARANCE** | 「🎨 Configure appearance…」— ディレクトリの名前バッジ・色・ヘッダーを対話的に設定 |
| **NOTIFICATION SOUNDS** | どの瞬間に鳴らすか＋それぞれ何を鳴らすか。種類ごとに1行、プリセット選択と試聴ボタン付き（→ [通知音](#sounds)） |
| **WEB PUSH NOTIFICATIONS** | 「Notify my devices when a task finishes」トグル（既定 OFF → [スマホ通知](notifications.html)） |
| **GOOGLE ACCOUNT** | Calendar 連携用の Google サインイン（RemoteHost の Connect とは別物） |
| **PULL REQUEST REPOS** | 横断 PR/Issue ビューが集約するリポ（`owner/repo`） |
| **LAUNCH COMMANDS** | グリッドセルで Claude 以外に起動できるコマンド（`{ label, command }`） |
| **MCP SERVERS** | 単一ビューのセッションに追加する自分の MCP サーバ |
| **COST (ESTIMATED)** | Session / Today / Month の推定コスト表示 |

## グローバル設定 `~/.mulmoterminal/config.json`

```json
{
  "cwdPresets": [
    { "label": "acme-web", "path": "/Users/you/projects/acme-web" },
    { "label": "acme-api", "path": "/Users/you/projects/acme-api" }
  ],
  "launchers": [
    { "label": "Shell", "command": "$SHELL" },
    { "label": "Node REPL", "command": "node" }
  ],
  "quickCommands": [
    { "label": "PR", "text": "PR作って", "agents": ["claude"] },
    { "label": "merge", "text": "mergeして" }
  ],
  "prRepos": ["acme/web", "acme/api"],
  "userMcpServers": [],
  "buttons": [],
  "chips": null
}
```

| キー | 役割 |
|---|---|
| `cwdPresets` | ランチャに並ぶ作業ディレクトリのチップ（`{ label, path }`。クリックで欄に入力、▶ で即起動） |
| `launchers` | グリッドセルの「OR LAUNCH」に並ぶ起動コマンド |
| `quickCommands` | **スマホ**のターミナル表示にチップとして並ぶ定型文（`{ label, text, agents? }`）。タップすると `text` が入力欄に入るだけで、**送信されるのは送信ボタンを押したとき**。`agents` で `"claude"` / `"codex"` / `"shell"` に絞れる（省略＝全種別）。設定画面の **Phone quick commands** で編集 |
| `prRepos` | 横断 PR/Issue ビューの対象リポ |
| `buttons` / `chips` | ヘッダーのボタン/チップ（プロジェクト設定とマージ。→ [ヘッダーのカスタマイズ](#header)） |
| `providers` | Anthropic 互換の接続先（→ [OpenRouter で別のモデルを使う](providers.html)） |
| `soundFile` | 全種類共通のフォールバック通知音（音声ファイルの絶対パス。設定モーダルからも変更可） |
| `soundKinds` | どの瞬間に鳴らすか。**書かなければ** `["finished","waiting"]`、2.2 で増えた4種は opt-in、`[]` で無音（→ [通知音](#sounds)） |
| `sounds` | 種類ごとの音。例 `{ "waiting": "preset:coin" }` — `preset:<id>` か絶対パス。未指定の種類は `soundFile` を使う（→ [通知音](#sounds)） |
| `pushEnabled` | Web Push の master スイッチ（既定 `false` → [スマホ通知](notifications.html)） |
| `pushKinds` | どの瞬間に飛ばすか：`"finished"`（ターン完了）と `"waiting"`（質問して停止）。**書かなければ両方**、`[]` でどれも飛ばさない（→ [どの瞬間に飛ぶか](notifications.html#kinds)） |
| `worklogEnabled` / `worklogIntervalHours` | 定期 dev-work ログ（既定 OFF / 6 時間） |
| `terminalSubmit` | どのバイトを**送信**／**改行**とみなすか — `"cr"`（既定）または `"esc-cr"`（→ [Enter — 送信と改行](#terminal-submit)） |
| `keymap` | ユーザ定義のキーボードショートカット。**既定は空——何も割り当てられていない**（→ [キーボードショートカット](#keymap)） |
| `copyOnSelect` | マウスで選択し終えた時点で、キーを押さずにクリップボードへ入れる。**既定 OFF**（→ [選択したらコピー](#copy-on-select)） |
| `prWorkdirFooter` | 作成した PR の本文末尾に `work in <クローン名>` を書く（→ [この PR はどのクローンの作業か](#pr-workdir-footer)）。**既定 ON**、`false` で無効 |
| `cockpitLines` | コックピットのロスター各行を何行で打ち切るか（既定 `2 / 2 / 3` → [ロスターの表示行数](#cockpit-lines)） |
| `fontFamily` | 全ターミナルのフォント（CSS の font-family スタック）（→ [ターミナルのフォント](#font-family)） |

## 通知音（`soundKinds` / `sounds`） {#sounds}

鳴る瞬間は6種類あり、それぞれ別の音・別の ON/OFF を持ちます。並列数を上げたときに通知が
うるさくなるのが本題なので、**既定で ON なのは最初の2つだけ**。残りは
**設定 → NOTIFICATION SOUNDS** か設定ファイルから opt-in します。

| 種類 | いつ | 既定 |
| --- | --- | --- |
| `finished` | ターンが終わって出力が未読 | **ON** |
| `waiting` | 許可プロンプトや質問で停止した | **ON** |
| `command-done` | Run セルのコマンドが正常終了（exit 0） | OFF |
| `command-failed` | Run セルのコマンドが異常終了、または起動に失敗 | OFF |
| `session-exited` | セッションの端末が終了。**自分でセルを閉じた場合も含む** | OFF |
| `pr-ci-failed` | そのディレクトリの PR が赤くなった。フェーズを取りに行くのはロスターなので、**ロスターが画面に出ている間だけ**拾えます | OFF |

```jsonc
{
  "soundKinds": ["waiting", "command-failed"], // 呼ばれた時とビルドが壊れた時だけ鳴らす
  "sounds": {
    "waiting": "preset:coin",
    "command-failed": "preset:gong"
  }
}
```

ここでいう **Run セル**は、`script.json` のエントリやヘッダーの `run:"shell"` ボタンが開く
**1コマンド専用の使い捨てセル**です。shell ランチャセルは対話シェルが生き続けるため、その中の
コマンドがいつ終わったかを誰も知りません（この2種類は鳴りません）。

8本並列で通知に疲れたときにまず触るのは `"soundKinds": ["waiting"]` です。呼ばれたことは
分かるまま、それ以外で作業が中断されなくなります。

### 何を鳴らすか

- **プリセット** — `preset:<id>`。`chime` `coin` `cheep` `door` `gong` `magic` `meow` の7種。
  初回だけ `~/.mulmoterminal/sounds/` に取得し、以降はそこから読むのでオフラインでも鳴ります。
  選ぶまで何もダウンロードしません。
- **自分のファイル** — 絶対パス。種類ごとに `sounds`、全種類共通なら `soundFile`。
- **未設定** — ブラウザで合成する内蔵チャイム。種類ごとに2音の形が違います（呼ばれている時は
  上昇、終わった時は下降）。

`sounds` に無い種類は `soundFile` にフォールバックし、プロジェクトの `.mulmoterminal.json`
はその両方より優先されます（→ [プロジェクト単位](#per-dir)）。

## 別のモデルで動かす（プロバイダ） {#providers}

Claude Code は Anthropic 互換のバックエンドなら何にでも接続できます。接続先は `config.json` の
`providers`、**鍵はサーバの環境変数**（設定ファイルには書きません）、既定のモデルはプロジェクトの
`.mulmoterminal.json`。そのうえで**起動時にセッション単位で選べます**。

```json
{
  "providers": [
    { "id": "openrouter", "label": "OpenRouter", "baseUrl": "https://openrouter.ai/api", "tokenEnv": "OPENROUTER_API_KEY", "maxOutputTokens": 16000 }
  ]
}
```

`baseUrl` の末尾に `/v1` を付けないこと、`tokenEnv` は鍵ではなく**変数の名前**であることに注意。

→ **手順・検証済みモデル一覧・モデルの追加方法・トラブルシューティングは
[OpenRouter で別のモデルを使う](providers.html) にまとめてあります。**

## この PR はどのクローンの作業か（`prWorkdirFooter`） {#pr-workdir-footer}

同じリポジトリのクローンを `myrepo`, `myrepo2`, `myrepo3` … と並べて使っていると、GitHub 上の
PR を見ても**どのクローンで作業したのか分かりません**。セルから PR へは辿れるのに、逆は勘に
なります。

そこで **⧉ Open PR** で作成した PR は、本文の末尾に作業したクローンの名前が入ります。

```
work in myrepo3
```

ここに入るのは **main のチェックアウト**のディレクトリ名で、worktree の名前ではありません。
MulmoTerminal は各タスクを `~/.mulmoterminal/worktrees/` 以下の worktree で動かしますが、その
名前は branch そのもので、branch は PR がすでに表示しているからです。

**既定は ON** です。切るときは `~/.mulmoterminal/config.json` に:

```json
{
  "prWorkdirFooter": false
}
```

次に作成する PR から反映されます。**再起動は不要**です（この設定は設定モーダルに項目が無いため、
PR 作成のたびにファイルから読み直しています）。

補足:

- この行が入るのは**このアプリが作成した PR だけ**です。既に PR がある branch で ⧉ Open PR を
  押しても、その PR が開くだけで、行が二重に付くことはありません。
- 後から GitHub 上で本文を編集して構いません。あとから書き換えられることはありません。
- 行の追記に失敗した場合（`gh` が無い、通信エラーなど）でも、**PR の作成自体は成功**して開き
  ます。行が付かないだけです。
## ターミナルのフォント（`fontFamily`） {#font-family}

全ターミナルが描画に使うフォントです。**設定モーダルに UI はありません**——
`~/.mulmoterminal/config.json` に CSS の font-family スタックを書きます。

```json
{ "fontFamily": "'Cica', 'ＭＳ ゴシック', monospace" }
```

書いたら **`mulmoterminal` を再起動**し、ブラウザのタブを再読み込みしてください。グローバル設定は
サーバ起動時に一度だけ読まれるため、手編集は再起動するまでブラウザに届きません——[`keymap`](#keymap) や
[`terminalSubmit`](#terminal-submit) と同じ注意点で、「設定したのに効かない」の典型的な原因です。
**ディレクトリごと**の指定（[後述](#per-dir)）はサーバ再起動こそ不要ですが、ファイル監視で拾われる
わけでもありません。再読み込みの条件は[後述](#per-dir-font)を参照してください。

フォント名は **OS のフォント一覧に表示されているとおり**に、使いたい順で並べてください。インストール
済みのものが先頭から採用されます。未設定（通常はこちら）なら組み込みのスタック——**JetBrains Mono →
Fira Code → Menlo → Consolas**、続いて日本語・韓国語・中国語の CJK フォント、最後に `monospace`——が
使われます。

**ディレクトリごと**に `.mulmoterminal.json` の `fontFamily`（[後述](#per-dir)）で上書きでき、そちらが
優先されます。フォント**サイズ**が表示上の好みとして設定モーダルで**ブラウザごと**に保持されるのに対し、
こちらはホストに 1 つの値です。指定するのは*フォント*であり、どのフォントが存在するかは、見ている
スマホや PC ではなくマシン側の性質だからです。

### 日本語フォントの選び方

**全角の字幅が半角のちょうど 2 倍**のフォントを選んでください。ターミナルは全角文字にきっかり 2 桁分を
確保するため、そうなっていないフォントでは罫線が崩れます——エージェントの TUI はほぼ罫線でできているので、
影響は大きいです。この条件を満たすものとしては **Cica**・**HackGen**・**Sarasa Mono J**・
**Noto Sans Mono CJK JP**・**ＭＳ ゴシック**・**BIZ UDゴシック** などがあります。

### 反映されないとき

- **どのフォントを指定しても何も変わらない。** サーバを再起動していない可能性が高いです。グローバル
  設定は起動時にしか読まれません（上記参照）。ディレクトリごとの `fontFamily` は再起動こそ不要ですが、
  手編集の場合はブラウザの再読み込みが必要です（→[ターミナルのフォント](#per-dir-font)）。
- **特定のフォントだけ効かない。** その名前のフォントが入っていないため、ブラウザがスキップして次の
  候補にフォールバックしています。フォント一覧の表記と綴りを見比べてください。
- **指定が丸ごと無視された。** スタックは 1 つの意図として検証されます。1 つでも不正な項目があると
  中途半端に効かせず全体を破棄し、組み込みスタックに戻ります。CSS の構文文字（`;` `{` `}` `(` `)` `<`
  `>` `\` `/` `@` `!`）は拒否され、引用符は名前全体を囲む対でなければなりません。
- **全体がプロポーショナルになった。** それはブラウザの既定フォント、つまりスタック内のどれ 1 つも
  一致しなかった状態です。総称ファミリを書かなかった場合は `monospace` が自動で補われるので、これが
  起きるのは末尾に自分でプロポーショナルなものを指定したときだけのはずです。

### 1 つのセッションで複数フォルダを見る（`addDirs`） {#add-dirs}

リポジトリと、その隣にある共有ライブラリのように、**複数のディレクトリを横断して**エージェントに作業させたい場合、これまでは複数フォルダを開けるエディタが必要でした。Claude Code は `--add-dir` を受け取るので、ディレクトリ側の設定として書けます。

```json
{
  "addDirs": ["../shared-lib", "/Users/me/notes"]
}
```

- 相対パスは**この設定ファイルがあるディレクトリ**を基準に解決します。`"../shared-lib"` は「プロジェクトの隣」であって、セッションが実際に動いている場所の隣ではありません（git worktree のセッションは `~/.mulmoterminal/worktrees/` から動きます）。
- 存在しないパスは**設定を読んだ時点で捨てます**。渡してしまうと「フラグは付いているのにエージェントには何も見えない」状態になるためです。最大 16 件。
- プロジェクト自身を書いても何も起きません（既にセッションの作業ディレクトリです）。
- **Claude 専用**です。codex には同じフラグが無いので、このキーは無視されます。
- **Docker サンドボックス**では、各ディレクトリを同じ絶対パスで bind mount します。そうしないとコンテナ内にそのパスが存在せず、許可が実体を伴いません。これはサンドボックスの範囲を意図的に広げる動作です — 一覧はあなた自身の設定ファイルから来ており、フラグを渡すこと自体と同じ行為だからです。

そのディレクトリで次に開くセッションから反映されます。

## Enter — 送信と改行（`terminalSubmit`） {#terminal-submit}

**Enter で送信するか、それとも改行を入れるか**を最終的に決めているのは MulmoTerminal ではなく
**Claude Code（の TUI）**で、判定は端末が送る*バイト列*に基づきます。関係するバイト列は 2 つです。

- **CR**（`\r`）— 素の **Enter** が送るバイト。
- **ESC + CR**（`\x1b\r`）— **Option/Alt+Enter**、および MulmoTerminal の **Shift+Enter** が送るバイト。

Claude Code の**標準**の割り当ては **CR＝送信 / ESC+CR＝改行**です。これが MulmoTerminal の既定なので、
**割り当てを変更していない限りこの設定は不要**です。人によっては Claude Code を逆
（**CR＝改行 / ESC+CR＝送信**）に設定していることがあり、その環境では Shift+Enter が*送信*になり、
スマホの「送信」もテキストが*入力されるだけで送信されません*。`terminalSubmit` は、キーボードと
スマホの両方をあなたの割り当てに合わせます。

```jsonc
{ "terminalSubmit": "cr" }      // 既定: Enter=送信 / Shift+Enter=改行
{ "terminalSubmit": "esc-cr" }  // 逆向き: Enter は ESC+CR で送信 / Shift+Enter=改行
```

| モード | Enter | Shift+Enter・Option/Alt+Enter | スマホの「送信」（リモートビュー） |
|---|---|---|---|
| `cr`（既定） | 送信（`\r`） | 改行（`\x1b\r`） | `\r` で送信 |
| `esc-cr` | 送信（`\x1b\r`） | 改行（`\r`） | `\x1b\r` で送信 |

**どちらのモードでも意味は同じ**（Enter＝送信 / Shift・Option+Enter＝改行）で、あなたの Claude の
割り当てに合わせて*バイトだけ*が入れ替わります。

### どちらを選べばいい？

ほとんどの人は既定（`cr`）のままで大丈夫です（設定不要）。`esc-cr` を選ぶのは、**MulmoTerminal で
Shift+Enter が改行ではなく*送信*になってしまう場合だけ**です（言い換えると、素の Enter が送信されず
改行になってしまう場合）。これは Claude Code が逆向きの割り当てになっているサインです。判断が付かない
ときは `cr` のままにして、Shift+Enter がおかしいときにだけ `esc-cr` に切り替えてください。

### 設定方法

1. `~/.mulmoterminal/config.json` を開き（無ければ作成）、トップレベルにキーを追加します。逆向きの
   割り当てなら次の通り:
   ```json
   { "terminalSubmit": "esc-cr" }
   ```
2. **ブラウザのタブを再読み込み**します — キーボードはページ読み込み時に値を読みます。
3. **`mulmoterminal` を再起動**します — スマホのリモートビュー「送信」は起動時にファイルから値を
   読むため、手編集を反映するには再起動が必要です。
4. 確認: 素の **Enter** で送信され、**Shift+Enter** で改行が入ることを確かめます。

値が不正（タイプミスや `"cr"` / `"esc-cr"` 以外）の場合は無視されて `"cr"` にフォールバックするので、
書き間違えても Enter が壊れることはありません。

### 補足

- **Claude セッションのみ** — `terminalSubmit` は *Claude Code* の割り当てを表すため、効くのは Claude
  セルだけです。**シェル**・**codex**・コマンドセルは `esc-cr` でも常に素の Enter（`\r`）で送信します
  — 逆向き設定がシェルの Enter を書き換えることはありません。
- **スマホ** — ソフトキーボードは素の **Enter** しか送れません（Shift+Enter は無く、Android では
  Return キーが通常の Enter ですらないことが多い）。そのためスマホでは Enter は上の表の通りに動き、
  画面上のキーボードから改行は入れられません。複数行はリモートビューの入力欄から送ってください。
- **日本語などの IME 入力** — 変換中の **Enter は変換確定**として扱われ、どちらのモードでも送信/改行
  にはなりません。日本語入力に影響はありません。

## キーボードショートカット（`keymap`） {#keymap}

キーボードショートカットは **opt-in** です。既定値はありません。`config.json` に `keymap` が無ければ何も
割り当てられず、キーを横取りすることもありません。これは意図的な設計です——**割り当てたキーは、その分
ターミナル内のプログラムに届かなくなります**。そのトレードオフが自分のワークフローに見合うかを判断できるのは
ユーザ自身だけだからです。

```json
{
  "keymap": {
    "zoom-next": "PageDown",
    "zoom-prev": "Shift+PageUp"
  }
}
```

### アクション

| アクション | 動作 | 拡大が必要 |
|---|---|---|
| `zoom-toggle` | **拡大 / 解除** — 拡大状態を変えるのはこのアクションだけ。カーソルのあるターミナルを拡大し、解除してもカーソルはそこに残る | 不要 |
| `zoom-next` | 画面上の並び順で**次**のターミナルへ拡大対象を移す | 必要 |
| `zoom-prev` | 同じく**前**へ | 必要 |
| `next-attention` | **見に行くべき次のターミナルへ移る** — 入力待ち → 完了・未レビュー → idle の順。作業中のセルは飛ばす。巡回する。**拡大も解除もしない**：拡大中は拡大対象が移り、非拡大時はそのターミナルにキーボードフォーカスを移す（フォーカス中のセルが浮き上がる）。必要ならページも切り替わる | 不要 |
| `terminal-new` | **末尾に**ターミナルを追加（ツールバーの `New terminal ＋` と同じ） | 不要 |
| `terminal-new-adjacent` | **今のターミナルの直後に**追加し、作業ディレクトリを引き継ぐ。「このターミナルを分割する」に最も近い | 必要 |
| `terminal-close` | 今のターミナルを**閉じる**（セルの `✕` と同じ） | 必要 |
| `copy` | ターミナルの選択範囲を**コピー**。**選択がある時だけ**動き、選択が無ければキーはそのままシェルへ届く — これにより `Ctrl+C` を割り当てても**中断（^C）を失いません** | 不要 |
| `paste` | ターミナルへ**ペースト** | 不要 |

多くのアクションは操作**対象**のターミナルを必要とし、グリッドが名指しできるのは拡大中のセルだけです。
拡大していないグリッドには「今のターミナル」が存在しないので、推測せず何もしません。**`zoom-toggle` か
`next-attention` のどちらかは必ず割り当ててください**——入口が無いと、「拡大が必要」なアクションは
マウスで `⤢` を押すまで一切使えません。拡大の移動は
**端で止まります**（巻き戻りません）。→ [基本編 → 拡大するターミナルの切り替え](basics.html#keyboard-zoom-switch)

{: .warning }
> **`terminal-close` は確認なしで即座に閉じます**——セルの `✕` と同じで、そのセッションは終了します。
> 誤爆しないキーに割り当ててください。

### すぐ使えるキーマップ例

既定では何も割り当てられていないので、**自分の指が既に覚えている操作系**に近いものを選んで、そこから
編集するのが早いです。以下のキーはいずれも[割り当てできない組み合わせ](#macos-keys)を避けてあります。

**最小構成 — 拡大に入って戻るだけ**

いちばん重要な2つです。どちらかが無いと、「拡大が必要」なアクションは `⤢` をクリックするまで一切
使えません。

```json
{ "keymap": { "zoom-toggle": "F8", "next-attention": "F9" } }
```

**tmux 風** — `Ctrl`+`B` が指に染みついている場合、それをここに割り当てると **tmux 自身から奪う**点に
注意してください。以下は tmux が使わない `Alt` を使っています。

```json
{
  "keymap": {
    "zoom-toggle": "Alt+z",
    "zoom-next": "Alt+n",
    "zoom-prev": "Alt+p",
    "next-attention": "Alt+a",
    "terminal-new": "Alt+c",
    "terminal-close": "Alt+x"
  }
}
```

{: .warning }
> **macOS では `Alt`+英字は動きません**。`Option` が別の文字を入力するため、英字として届きません
> （[上の節](#macos-keys)参照）。Mac の方は下の矢印キー版をどうぞ。

**iTerm2 風** — `Cmd`+`D` のペイン分割に最も近い形です。`terminal-new-adjacent` は今のターミナルの隣に
作業ディレクトリを引き継いで開くので、グリッドにおける「分割」に相当します。

```json
{
  "keymap": {
    "zoom-toggle": "Cmd+Enter",
    "zoom-next": "Cmd+]",
    "zoom-prev": "Cmd+[",
    "next-attention": "Cmd+Shift+A",
    "terminal-new-adjacent": "Cmd+d"
  }
}
```

{: .note }
> `Cmd`+`W` を**あえて入れていません**。ブラウザの予約キーなので、閉じる操作には使えないためです。
> `Cmd`+`Shift`+`W` なら使えます。

**矢印キー — 最も安全なクロスプラットフォーム構成。** 矢印キーは macOS の `Option` 問題の影響を受けず、
ブラウザ予約でもないので、どの環境でも同じように動きます。

```json
{
  "keymap": {
    "zoom-toggle": "Alt+ArrowUp",
    "zoom-next": "Alt+ArrowRight",
    "zoom-prev": "Alt+ArrowLeft",
    "next-attention": "Alt+ArrowDown",
    "terminal-new-adjacent": "Alt+Shift+ArrowRight"
  }
}
```

**多数のエージェントを見張る用途** — 1つのキーを連打して、呼んでいるものを順に巡る構成です。入力待ち →
完了・未レビュー → idle の順に辿り、作業中のものは飛ばします。

```json
{ "keymap": { "next-attention": "F9", "zoom-toggle": "F8" } }
```

### 記法

`修飾キー+修飾キー+キー`。キーはブラウザの `KeyboardEvent.key` の値と照合されます。

- **修飾キー**：`Shift` / `Ctrl`（`Control`）/ `Alt`（`Option`）/ `Cmd`（`Command`・`Meta`）。大文字小文字は問いません。
- **キー**：ブラウザが返すそのままの値——`PageDown`・`Home`・`F5`・`ArrowUp`・`a` など。印字可能な文字は
  **大文字小文字を区別**します（`A` は Shift 併用を意味します）。
- **修飾キーは完全一致**です。`PageDown` を割り当てても `Shift+PageDown` では発火せず、そのキーストロークは
  ターミナルに残ります。xterm のスクロールバック用に `Shift`+`Page Up`/`Page Down` を残せるのはこの仕組みです。
- 不正な記法（未知の修飾キー、`Shift` 単独、末尾の `+` など）があると、MulmoTerminal は**起動を拒否**し、
  該当行を表示します。黙って無視すると「ショートカットが効かない」と見分けがつかず、たった1文字の設定ミスを
  アプリ側で探し回ることになるためです。
- **同じキーストロークに2つのアクションを割り当てた場合**、先に来た方しか発火しないため、起動時に両方を挙げて
  **警告**します。判定はパース後のキーストロークで行うので、`Shift+PageUp` と `shift+PageUp` は同一と見なされます。
- IME 変換中は常に素通しするため、日本語入力の候補選択が横取りされることはありません。
- **Mac ではファンクションキーと `Option`+英字に注意** — 選ぶ前に[下の節](#macos-keys)を参照してください。

### そもそも割り当てできない組み合わせ

MulmoTerminal はブラウザのタブ上で動くため、**抑止可能な形では web ページに届かないキー**があります。

| 組み合わせ | 理由 |
|---|---|
| `Cmd`/`Ctrl`+`W`・`Cmd`/`Ctrl`+`T`・`Cmd`/`Ctrl`+`N`・`Cmd`/`Ctrl`+`Shift`+`T` | **ブラウザの予約キー**（タブを閉じる／新規タブ／新規ウィンドウ）。ページ側から横取りできず、割り当てても**何も起きません** |
| macOS の `Ctrl`+`Cmd`+`D` など | **OS が先に消費**する場合があります（これは「辞書で調べる」）。ブラウザまで届かないことがあり、システム設定に依存します |
| `Ctrl`+`C` / `Ctrl`+`D` / `Ctrl`+`B` など | **割り当て自体は可能**ですが、shell・`readline`・`tmux` が使うキーです。割り当てるとターミナルから奪われます——許可はしますが、通常は避けたい選択です |

### Mac ではファンクションキーに注意 {#macos-keys}

**既定では `F1`〜`F12` はブラウザに届きません。** Apple は[「キーボードのファンクションキーは、初期設定では
システム機能を操作するように設定されています」](https://support.apple.com/guide/mac-help/use-keyboard-function-keys-mchlp2596/mac)
と明記しています（明るさ・音量など）。この状態では `F2` を押してもページに keydown が配送されないため、
割り当てても**完全に無反応**に見え、MulmoTerminal 側からは検知すらできません。対処は2つ、どちらも Apple の
ガイドに沿ったものです。

- **`Fn`**（または **Globe** キー）を押しながら押す。`"F2"` の割り当てにマッチします。`Fn` はブラウザが報告する
  修飾キーではないので、割り当て文字列に書く必要はありません。*（macOS で実機確認済み: `Fn`+`F2` で `"F2"` の
  割り当てが発火します。）*
- または既定を切り替える: **システム設定 → キーボード → キーボードショートカット → ファンクションキー →
  「F1、F2 などのキーを標準のファンクションキーとして使用」**。素のキーで効くようになり、`Fn` 併用が逆に
  システム機能になります。（旧 macOS では「システム環境設定 → キーボード」にあります。手順は Apple の
  [解説記事](https://support.apple.com/ja-jp/102439)を参照。）

どのキーがどのシステム機能に対応するかはキーボードと macOS のバージョンによって異なり、**Apple は固定の
対応表を公開していません**。設定を変えても特定のキーだけ無反応なら、まだシステム側が握っていると考えて別の
キーを選んでください。下のコンソール確認でどちらの状況かが分かります。

**`Option`+英字は macOS では選択として不向きです。** 割り当ては `KeyboardEvent.key` と照合されますが、
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key) によれば `key` は修飾キーと
キーボードレイアウトを適用した後に**実際に入力される文字**を返し、デッドキーの場合は文字列 `"Dead"` になります。
macOS は `Option` を代替文字やアクセントの入力に使うため、`Option`+英字はその文字として届き、英字にはなりません。
したがって `"Alt+n"` のような割り当ては一致しません。Option を使うなら**印字されないキー**
（`Alt+ArrowDown`・`Alt+PageUp` など）と組み合わせてください。決める前に下のスニペットで自分のレイアウトを
確認するのが確実です。

{: .note }
> そのキーが実際に何を送っているか分からないときは、ブラウザの devtools コンソールに次を貼って押してみて
> ください。**何も出力されなければ、ページに届く前に OS かキーボードが奪っています**——この場合どんな割り当ても
> 効きません。`keymap` に書いたものと違う値が出るなら、実際に出た値のほうを割り当ててください。
>
> ```js
> addEventListener("keydown", e => console.log(e.key, e.code, {shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey}), true);
> ```
{: .note }
> **未知のアクション名は警告のみ**で、起動は続行します——新しいバージョン向けに書かれた設定はこう見えるので、
> ダウングレードでアプリが使えなくなってはいけないためです。並べ替え・ページ切替・ナビゲーション等の追加
> アクションは [issue #829](https://github.com/receptron/mulmoterminal/issues/829) で追跡しています。

## 選択したらコピー（`copyOnSelect`） {#copy-on-select}

ターミナルの出力をドラッグして離した瞬間に、クリップボードへ入ります。キーは押しません。
PuTTY や iTerm2 が昔からそうなっている挙動で、Windows Terminal では `copyOnSelect` と呼ばれます。

**書かない限り OFF** です。読んでいて何気なくなぞっただけのつもりでも、クリップボードの中身が
入れ替わるためです。

```json
{ "copyOnSelect": true }
```

設定ファイルのみで、設定モーダルにはありません。反映にはサーバの再起動が必要です。

[`copy` のキーバインド](#keymap)とは併用できます。キーボードで選択したものをコピーしたい場合など、
キーからも使いたければ `copy` の割り当ては残したままで構いません。

以下の 2 つは**意図的にコピーしません**。どちらも、いま入っているクリップボードを守るためです。

- **空白だけの選択** — ターミナルの空いている場所をドラッグすると、黙ってクリップボードが空白の
  並びに置き換わってしまうため。インデントを本当にコピーしたい場合は `copy` のキーバインドを使ってください
- **直前と同じ文字列** — OS のクリップボード履歴に同じものが増えるだけのため

{: .note }
> **`http://` で開いている場合、ブラウザはページにクリップボードを一切触らせません** — この API は
> `https://` と `localhost` に限定されています。MulmoTerminal はキーボードショートカットと同じ経路
> （xterm 自身にコピーさせる）へフォールバックし、そちらは動きますが、**ターミナルがキーボード
> フォーカスを持っている必要**があります。`http://<IP>:PORT` で開いていてドラッグしてもコピーされない
> 場合は、まずここを疑ってください。`http://localhost:PORT` ならこの制限はかかりません。

## ロスターの表示行数（`cockpitLines`） {#cockpit-lines}

ターミナルを拡大すると、残りは横に**ロスター**として並びます。1 セッションにつき 3 行——
**summary**（そのセッションが今なにをしているか）、**prompt**、**reply**——で、長いロスターでも
画面に収まるようそれぞれ途中で打ち切られます。

この打ち切りは不具合ではなく**トレードオフ**です。行数を増やせば 1 件あたりは読めますが、
同時に見えるセッション数は減ります。文章として書かれた summary が途中で切れて一番困るので、
上げる価値があるのはたいてい summary です。

```json
{ "cockpitLines": { "summary": 6, "prompt": 2, "response": 3 } }
```

| 項目 | 打ち切る対象 | 既定 |
|---|---|---|
| `summary` | そのセッションが今なにをしているか | `2` |
| `prompt` | 送ったプロンプト | `2` |
| `response` | エージェントの返答 | `3` |

- 各項目は **1〜20** の整数。範囲外の数値はこの範囲に**丸め込まれ**、小数は**四捨五入**されます
  ——指定した方向がそのまま効くので、黙って既定に戻されることはありません。
- 非数値は**その項目だけ**既定に戻ります——1 つの書き間違いが他の 2 つを巻き添えにしません。
- `cockpitLines` を書かなければ、ロスターは従来とまったく同じ見た目です。
- 打ち切られていても**ホバーすれば全文が読めます**。行数を上げるのはホバーの手間を省く話であって、
  長い summary を読む唯一の手段ではありません。
- **タブのリロード**で反映されます。

{: .note }
> これは**全体設定**で、ディレクトリごとの設定ではありません。ロスターは複数ディレクトリの
> セッションを混ぜて並べるため、ディレクトリ単位にすると隣り合う行で高さの根拠が食い違います。

## プロジェクトごとの `.mulmoterminal.json` {#per-dir}

プロジェクト直下に置くと、**そのディレクトリで開いた端末（グリッドセル）**の見た目・音・ヘッダーを変えられます。

### 使うモデル

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

そのディレクトリのセッションが既定で使うバックエンドとモデル。`provider` を省いて `model` だけ書くと
Anthropic のまま別のモデルを指定できます。→ [OpenRouter で別のモデルを使う](providers.html)

### 名前バッジと色

```json
{
  "name": "acme-web",
  "badgeColor": "#2563eb",
  "headerColor": "#0b2545",
  "headerTextColor": "#e6f0ff",
  "cellColor": "#0e1117",
  "cellBorderColor": "#1f6f4f",
  "dotColor": "#22c55e",
  "buttonColor": "#a7f3d0"
}
```

すべて `#rrggbb`。作業中/要対応の状態色は、これらの背景色より優先されます（アイドル時に反映）。

### このディレクトリの通知音

```jsonc
{
  "sound": "./.mulmoterminal/alert.mp3", // 全種類共通（下で上書きしない限り）
  "sounds": { "command-failed": "preset:gong" } // 特定の種類だけ
}
```

ここで開いたターミナルでは、どちらもグローバル設定より優先されます。プロジェクトごとに音を
変えれば、耳だけで区別できます。ファイルパスは**このディレクトリからの相対**で、絶対パスや
`../` で外に出るものは拒否されます。`preset:<id>` もここで使えるので、プロジェクト側に音声
ファイルを置く必要はありません。→ [通知音](#sounds)

### ターミナル自体の色（xterm パレット）

`headerColor` などが「**枠**（ヘッダー・セル）」の色なのに対し、**`colors`（と `theme`）は端末の中身（xterm）**を染めます。
`colors` は xterm の ITheme——`background` / `foreground` / `cursor` や `red` `green` … の ANSI 16 色——を上書きできます。

```json
{
  "name": "🌌 van-gogh",
  "headerColor": "#0b1a4a",
  "headerTextColor": "#f2e29b",
  "colors": { "background": "#0a1330", "foreground": "#f2e29b", "cursor": "#f5b301" }
}
```

`theme` に `midnight` / `nord` / `daylight` / `solarized` を指定するとプリセットのパレットになり、`colors` はその上へ部分上書き。
[応用編 6](scenarios.html) の色分けスクショは、ヘッダー色と `colors` を組み合わせて**ヘッダーから端末の中身まで**プロジェクトごとに染めた例です。

### ターミナルのフォントサイズ（`fontSize`） {#font-size}

`fontSize` はこのディレクトリのターミナルのフォントサイズ（px）で、設定モーダルの値を上書きします。

```json
{ "fontSize": 16 }
```

有効範囲は **8〜32**。範囲外の値は近い端に丸められます（`99` は無視されず 32 になります）。数値でない値は無視され、
設定モーダルの値が使われます。

ブラウザのズーム（Ctrl +/−）ではなくこちらを使ってください。ズームはターミナルに知らせずページを拡大するため、
xterm の文字グリッドとシェルが認識しているウィンドウサイズがずれ、カーソル位置や折り返し位置が崩れます。
`fontSize` はターミナルを再フィットして新しい桁数・行数をプロセスに送るので、ずれが起きません。

### ターミナルのフォント（`fontFamily`） {#per-dir-font}

`fontFamily` はこのディレクトリのターミナルのフォントスタックで、グローバルの
[`fontFamily`](#font-family) を上書きします。

```json
{ "fontFamily": "'Cica', 'ＭＳ ゴシック', monospace" }
```

ルールはグローバル側と同じです。選び方・不正な値の扱い・CJK フォントで字幅が 2 倍である必要がある理由は
[ターミナルのフォント](#font-family)を参照してください。ふだんは ASCII 中心だが、このリポジトリのログだけ
日本語が多い、といった場合に便利です。

グローバル側と違い、こちらは**サーバ再起動が不要**です。ただしファイル監視をしているわけでもありません。
MulmoTerminal が `.mulmoterminal.json` を読み直すのは、**Claude の Write/Edit ツールが「書いた」と
報告したとき**です（`/mulmoterminal-config` を実行するとセルの色がその場で変わるのはこのため）。
エディタなど**外部から手で書き換えた**場合、すでに開いているターミナルはブラウザのタブを再読み込み
するまで古いフォントのままです。
### グリッドでの並び位置（`orderPriority`） {#order-priority}

`orderPriority` は、グリッドの **priority** 並び順における順位です。ツールバーの並び順ボタンの3つ目のモードで、
auto（注目度順）と manual（移動ボタンで手動）と並びます。

```json
{ "orderPriority": 10 }
```

- **小さい順**。負数も使えるので、`0` の全プロジェクトより前に出すこともできます
- **未設定のディレクトリは末尾**にまとまり、既存の順序を保ちます — 1つのプロジェクトに追加しても他が動きません
- 同順位は現在の順を維持。同じディレクトリのセルが複数ある場合も同様です（順位は**ディレクトリ**の属性で、セルの属性ではありません）

読むのは **priority** モードだけです。ボタンを auto や manual にしている限り、プロジェクト側が何を宣言していても
表示は変わりません。

### ヘッダーのカスタマイズ（ボタン / チップ） {#header}

MulmoTerminal の「**拡張**」の柱がここ。稼働中ターミナルのヘッダーを、**小さな DSL** で自分のワークフローに合わせて成形できます。
どんな開発者でも、よく使う操作をワンクリックにし、見たい情報だけを出せる——それがこの仕組みの狙いです。

**ボタン**（`buttons`）— 稼働中セッションに効く操作ボタン。表示は `emoji` または `icon`（Material Symbol 名）＋ `label`、`order` で並び順を指定できます。
未設定なら**組み込みの既定セット**が表示されます: 📎 ファイルパス挿入・📂 ファイルマネージャで開く・📁 アプリ内でファイル一覧・🖥 このディレクトリで新規ターミナル・🔗 このブランチの PR（git リポかつ PR がある時のみ）・🌐 GitHub で開く（git リポ）。`buttons` をどこかで書くと既定セットは**丸ごと置き換え**られます（マージ**されません**）。つまり自分のリストを書けば——**短い**リストでも——並べ替え・削減・差し替えができます。

```json
{
  "buttons": [
    { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "gh",      "emoji": "🌐", "label": "Open on GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
    { "id": "reveal",  "emoji": "📁", "label": "Reveal folder", "run": "open", "open": { "reveal": "${dir}" } },
    { "id": "build",   "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
  ]
}
```

- `run: "input"` … 稼働中の Claude/Codex に `text` を送信（例 `/compact`）。
- `run: "open"` … `url`（ブラウザ, http/https のみ）/ `reveal`（OSのファイルマネージャ: Finder/Explorer/xdg-open）/ `files`（アプリ内エクスプローラ）/ `pickFile`（OSのファイル選択でパス挿入）/ `terminal`（そのディレクトリで新しい端末セルを開く）/ `pr`（現在ブランチの PR をブラウザで開く）/ `view`（`diff`/`prs`/`wiki`/`collections`/`accounting`）。
- `run: "shell"` … `cmd` をコマンドセルで実行（サーバ側で id 解決 + `${変数}` はシェルエスケープ、コマンドはブラウザに渡らない）。
- `${変数}` … `dir` `dirName` `branch` `repo` `remoteUrl` `ahead` `behind` `dirty` `agent` `model` `task` `session`。
- `when` … `isGitRepo` / `agent == …` / `repo == …`（`&&` / `||`、`&&` が優先）。

**チップ**（`chips`）— グリッドセルヘッダーの情報チップを並べ替え/非表示 + カスタム。`null`（既定）は従来どおり。

```json
{ "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }] }
```

- 組み込み `dir` / `git` / `diff` / `ctx` / `usage` / `status` / `tools` … 並べた順に表示、書かなければ非表示。
- カスタム `{ label, text, when }` … 読み取り専用テキスト（`text` は `${変数}` 展開）。

### ⚡ Skill メニューの絞り込み（`skills`）

ヘッダーの **⚡ Skill ▾** はそのディレクトリで使えるスキル（`<project>/.claude/skills` と `~/.claude/skills`）を一覧します。working dir（プロジェクト）のスキルが先頭、その後にユーザースコープ。選ぶと**今のセッション**でそのスキルを実行します（Claude は `/<slug>`、Codex は `Use the "<slug>" skill.`）。

`skills` を書くと**その slug だけを、その並び順で**表示する許可リストになります。**書かなければ全部**表示。

```json
{ "skills": ["review-diff", "commit-msg"] }
```

- スキル名（slug）は英数字始まりで `a-z 0-9 - _` のみ。存在しない slug は無視されます。

## スクリプト `<project>/script.json`

グリッドセルで実行できるプロジェクトのスクリプト（dev サーバ・テスト・ビルドなど）。

```json
{ "scripts": [ { "label": "dev", "command": "yarn dev" }, { "label": "test", "command": "yarn test", "cwd": "." } ] }
```

## 環境変数

| 変数 | 既定 | 役割 |
|---|---|---|
| `CLAUDE_CWD` / `--cwd` | 実行したディレクトリ（`npx mulmoterminal`。サーバを直接起動した場合のみ `~/mulmoclaude`） | 既定の作業ディレクトリ（PTY の cwd）。`--cwd` でも指定可 |
| `PORT` | `34567` | サーバのポート |
| `MULMOTERMINAL_HOST` | `127.0.0.1` | サーバが待ち受けるインターフェース（→ [下記](#bind-host)） |

### 誰がサーバに到達できるか（`MULMOTERMINAL_HOST`） {#bind-host}

サーバは **loopback のみ**で待ち受けます。この機体からしか応答しません。これが正しい既定である理由は、
**MulmoTerminal 自体にログインの仕組みが無い**からです。ソケットを開ければ、セッションの閲覧も、
セッションの作業ディレクトリ配下のファイル閲覧も、ターミナルの起動もできてしまいます。

意図して広げる場合は `MULMOTERMINAL_HOST` を設定します（全インターフェースなら `0.0.0.0`、特定の
アドレスも可）。`localhost` も指定でき、通常は loopback に解決されます——ただし hosts ファイルで別の
アドレスに向けることもできるため、下記の警告は**実際に束縛されたアドレス**（`server.address()`）を見て
判定します。指定した文字列ではありません。loopback 以外だった場合は**起動時に警告を表示**します。
他に気づく手段が無いためです。

```bash
MULMOTERMINAL_HOST=0.0.0.0 npx mulmoterminal   # 信頼できる網でのみ — 下の注意を参照
```

**これはポート転送のための設定で、別マシンのブラウザから使うためのものではありません。** ターミナルの
WebSocket を守る同一オリジン判定は **localhost のオリジンしか受け付けない**ため、ネットワーク上の別マシンから
`http://<この機体>:34567` を開くと、ページは表示されてもターミナルに接続できません。この設定が役に立つのは、
**Docker コンテナ**や **WSL** のようにローカルポートを転送する場合です。内側では `0.0.0.0` に束縛しないと
転送が届かず、外側のブラウザは `localhost` で接続するためオリジン判定を通ります。

**スマホから使うためにこの設定は不要です。** スマホ連携は Firestore 経由で、ローカルネットワークを
使いません（→ [スマホから使う](phone.html)）。
| `MULMOTERMINAL_HOME` | `~/.mulmoterminal` | 管理下 git worktree のルート |

---

← [機能一覧に戻る](features.html) ／ [日本語ガイドの目次](index.html)
