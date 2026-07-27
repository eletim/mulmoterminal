# feat: grid / single のビュー切り替えを他のメニュー項目と視覚的に分ける (#941)

## 問題

ヘッダー左のナビに、性質の違う 2 種類が等間隔で並んでいて見分けがつかない。

- **どのビューにいるかを変える**もの: Chat / Grid view
- **今いるビューの中で何かを出す**もの: Collections / Accounting / Wiki / お気に入り /
  Pull requests / Worklog / New terminal / 並び替え

## 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| 分け方 | **縦線**（案 A） | 同じ `<nav>` の反対端にあるステータス集計が既に `border-l border-border pl-2.5` で区切られている。表現を増やさず揃える |
| 区切りの位置 | **右だけ** | 左はヘッダーのロゴが境界になっている |
| a11y | `role="group"` + `aria-label="Switch view"` | 視覚的なグループ分けを支援技術にも伝える。見た目だけの区切りは読み上げに出ない |
| 実装 | 2 つを `<span>` で包む | ナビは flex なので包んだ span が 1 つの flex item になる。中で `gap-[3px]` を張り直し、`flex-none` で overflow 時に潰れないようにする（#921 と同じ理由） |

## 実装

`src/components/AppToolbar.vue` の 1 箇所のみ。ロジック変更なし。

```
<span class="mr-1.5 inline-flex flex-none items-center gap-[3px] border-r border-border pr-2.5"
      role="group" aria-label="Switch view">
  Chat / Grid view
</span>
```

既存の `AppToolbar.spec.ts` は `nav[aria-label='Views'] button` を数えているので、
span で包んでも nav の子孫であることは変わらず、そのまま通る。
グループが存在することを固定するテストを 1 本足す。
