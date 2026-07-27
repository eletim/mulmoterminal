# feat(cockpit): ロスター各行の表示行数を設定可能にする（`cockpitLines`）

issue: #877 ／ 出典: @meki-nana さんの提案・実装（#863、close 済み）

## 課題

コックピット（拡大したターミナルの横に並ぶロスター）は summary / prompt / reply を
**2 / 2 / 3 行**で打ち切る。文章として書かれた summary は途中で切れるが、まさにその
summary こそ読みたい場面が多い。

一方で行数を増やせば画面に載るセッション数は減る。これは「直すべき不具合」ではなく
**使う人が決めるトレードオフ**なので、既定を変えずに設定で開ける。

## 決めたこと

- `~/.mulmoterminal/config.json` の `cockpitLines` で 3 項目それぞれの行数を指定する。
- 既定は **2 / 2 / 3**。未設定なら現在とまったく同じ挙動（opt-in）。
- 各項目 1〜20 の整数。範囲外は範囲内へ **clamp**、小数は **round**（`normalizeFontSize` /
  `sanitizeWorklogIntervalHours` と同じ規約。有界な数値はユーザが「方向」を指定しているので、
  既定に戻すより指定を尊重するほうが「効いている」と読める）。非数値は**項目ごとに**既定へ
  戻すので、1 つの書き間違いが他の 2 つを巻き添えにしない。
- 打ち切られた行は `title` でホバーすれば全文が読める。行数を上げるのは利便性の話であって、
  それしか読む手段がない状態にはしない。
- **全体設定**にする（ディレクトリ単位にしない）。ロスターは複数ディレクトリのセッションを
  混ぜて並べるので、ディレクトリ単位だと隣り合う行で高さの根拠が食い違う。
- 設定 UI は持たせない。`keymap` / `terminalSubmit` と同じく config.json のみ。

## 実装方針

### 値の置き場所

`common/cockpitLines.ts` に型・既定値・`sanitizeCockpitLines()`。server が sanitize して
`/api/config` で配り、client が描画に使う＝**両側が判断に使う値**なので `common/`
（CLAUDE.md の `common/` ルール）。

**CSS を作る関数は `common/` に置かない。** サーバは clamp の見た目を知る必要がないので、
描画は `src/` 側だけで完結させる。

### clamp の当て方

Tailwind の `line-clamp-N` は「ソースに literal で現れたクラスしか生成されない」ので実行時の
数値には使えない。CSS 変数を挟んで、**ユーティリティはソースに固定文字列として残す**:

```html
<span class="line-clamp-[var(--cockpit-lines)] …" :style="{ '--cockpit-lines': n }">
```

`docs/styling.md` の「動的値は design token 経由でユーティリティに読ませる」に沿う形。
インラインで `-webkit-line-clamp` を組み立てるより、生成される CSS が Tailwind 側に一本化される。

### server 側で足す場所（5 箇所）

`server/config/app-config.ts` の以下**すべて**に足す。1 つでも漏れると値が消える:

| 場所 | 漏らすとどうなるか |
|---|---|
| `AppConfig` | — |
| `emptyConfig()` | 初期値が undefined |
| `sanitizeAppConfig()` | ファイルから読んでも反映されない |
| `mergeConfigUpdate()` | **`POST /api/config`（設定保存）を通ると消える** |
| `toPublicAppConfig()` | **client に配られない**（＝設定しても効かない） |

`AppConfig` が必須プロパティとして持つので、漏れは `yarn typecheck:server` が止める。
#863 は `mergeConfigUpdate()` と `toPublicAppConfig()` の 2 箇所が漏れていた。

### client 側

`src/composables/cockpitLines.ts` にシングルトン ref（`activeKeymap.ts` と同じ形）。
hydration は非同期で、読むのはテンプレートなので ref である必要がある。
`useAppConfig.ts` の設定読み込み時に `setCockpitLines()` する。

## 変更ファイル

- `common/cockpitLines.ts`（新規）
- `src/composables/cockpitLines.ts`（新規）
- `server/config/app-config.ts`
- `src/composables/useAppConfig.ts`
- `src/components/TerminalGrid.vue`
- `server/skills/mulmoterminal-config/SKILL.md`
- `docs/guide/{en,ja}/config.md`（両言語）
- `test/common/cockpitLines.spec.ts`（新規）
- `test/server/config/app-config.spec.ts`

## テスト

- `sanitizeCockpitLines()`: 正常値、未設定、非オブジェクト、項目ごとのフォールバック、
  範囲の両端、範囲外の clamp、NaN / Infinity、小数の四捨五入。
- `app-config.spec.ts`: 既定値、ファイル往復、不正値の sanitize。
