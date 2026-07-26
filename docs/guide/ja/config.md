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
> [`terminalSubmit`](#terminal-submit)（「Shift+Enter で改行ではなく送信されてしまう」の対処）・定期 dev-work ログ。
> 手編集でも構いません（このページに全フィールドの説明があります）が、スキルは書きながら検証します。
> これは特に `keymap` で効いてきます——記法を間違えるとサーバが起動しなくなるためです。

---

## 設定モーダル（⚙）

ツールバーの ⚙ から開きます。

![設定モーダル](../images/settings.png)

| 項目 | 内容 |
|---|---|
| **THEME** | Midnight / Nord / Daylight / Solarized Light |
| **DIRECTORY APPEARANCE** | 「🎨 Configure appearance…」— ディレクトリの名前バッジ・色・ヘッダーを対話的に設定 |
| **NOTIFICATION SOUND** | 要対応時に鳴らす音（空なら内蔵チャイム、または任意の音声ファイル） |
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
| `soundFile` | カスタム通知音（音声ファイルの絶対パス。設定モーダルからも変更可） |
| `pushEnabled` | Web Push の master スイッチ（既定 `false` → [スマホ通知](notifications.html)） |
| `pushKinds` | どの瞬間に飛ばすか：`"finished"`（ターン完了）と `"waiting"`（質問して停止）。**書かなければ両方**、`[]` でどれも飛ばさない（→ [どの瞬間に飛ぶか](notifications.html#kinds)） |
| `worklogEnabled` / `worklogIntervalHours` | 定期 dev-work ログ（既定 OFF / 6 時間） |
| `terminalSubmit` | どのバイトを**送信**／**改行**とみなすか — `"cr"`（既定）または `"esc-cr"`（→ [Enter — 送信と改行](#terminal-submit)） |
| `keymap` | ユーザ定義のキーボードショートカット。**既定は空——何も割り当てられていない**（→ [キーボードショートカット](#keymap)） |

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
| `MULMOTERMINAL_HOME` | `~/.mulmoterminal` | 管理下 git worktree のルート |

---

← [機能一覧に戻る](features.html) ／ [日本語ガイドの目次](index.html)
