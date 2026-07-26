# refactor #828 — `isRecord` を `common/` の 1 本に集約する

`isRecord` が 29 ファイル（`test/` を入れると 32）で個別に定義されている。#826 でスコープ外にした分。

## 調査結果

### 定義は同一ではなかった

31 個の定義を集計すると:

| 実装 | 個数 |
|---|---|
| `(v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null` | 23 |
| 同じロジックで引数名が `value` / `d` | 5 |
| `function` 宣言形式 | 2 |
| **`&& !Array.isArray(v)` 付き**（`server/config/header-config.ts`） | **1** |

### 配列を除外するのが正しい

TypeScript 自身が配列を `Record<string, unknown>` として扱わない:

```
TS2322: Type 'unknown[]' is not assignable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'unknown[]'.
```

つまり配列除外なしの 30 個は**型の嘘**を吐いている。`header-config.ts` だけが自力で気づいて除外していた。

### 厳格化は安全

呼び出しは 100 箇所。ほぼ全てが `isRecord(x) && typeof x.field === "..."` の形で、配列が来ても
現状すでに false になる。値を列挙しているのは `server/session/activity-state.ts` だけで、これは
JSON ファイルの読み込み（トップレベル配列は不正入力で、続く `isValidId` が弾く）。挙動が変わるのは
「不正入力をより早く弾く」方向のみ。

### graphai の扱い

グローバル CLAUDE.md は「自前実装より既存ライブラリのユーティリティ（例: graphai の `isObject`）」と
指示している。graphai は `dependencies` にあり、`src/composables/collectionUiRules.ts` 経由で
**既にブラウザバンドルに入っている**（本変更前後でバンドルサイズは 3920 KB のまま）。

- `isObject` — root から export されているが `x !== null && typeof x === "object"` で、上記の型の嘘を持つ
- `isPlainObject` — 配列・Map・Date・クラスインスタンスを弾く理想形だが、**パッケージ root から
  export されていない**（実行時 `undefined`）。内部パス（`graphai/lib/utils/utils`）に依存するのは不可

→ **`isObject` に乗せたうえで、配列除外だけこちら側で足す。**

## 変更

```ts
// common/isRecord.ts
import { isObject } from "graphai";
export const isRecord = (value: unknown): value is Record<string, unknown> => isObject(value) && !Array.isArray(value);
```

- 名前は `isRecord` のまま → 呼び出し 100 箇所は無変更。各ファイルは定義行を消して import を足すだけ
- import の拡張子は各ツリーの規約に従う（`server/` `test/server/` `common/` は `.js`、`src/` は無し）
- `server/session/transcript.ts` が `export` していた分の import 元（`cost.ts` / `last-turn.ts` /
  `session-reads.ts` / `plugin-*.ts` / `toolResultPlan.ts` / `dirRequest.ts` / `codex-activity.ts`）と、
  `server/git/ghItem.ts` から import していた `prs.ts` も `common/` に向け直す

## テスト

`test/common/isRecord.spec.ts` — 通常のオブジェクト、**配列（今回変わる挙動）**、null/undefined、
プリミティブ、関数、Date/Map（弾かないという既知の割り切り）、`JSON.parse` 結果の絞り込み。

## スコープ外

- `src/composables/collectionUiRules.ts` が graphai の `isObject` を直接使っている箇所（同じ概念の
  もう 1 つのコピーだが、#828 は `isRecord` の重複が対象）
