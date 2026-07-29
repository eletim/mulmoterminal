# Windows のフォルダ選択をエクスプローラー型にする

Issue: #1003（外部からの報告。原因箇所まで特定されていた）

## 症状

Windows でランチャーの「WORKING DIRECTORY」のフォルダアイコンを押すと、旧ツリー型の
「フォルダーの参照」が開く。アドレスバーもパス入力も無く、目的のフォルダまで階層を辿るしかない。

## 原因（確認済み）

`server/files/pick-file.ts` の `winArgs()` が `powershell`（= Windows PowerShell 5.1、
.NET Framework）で `System.Windows.Forms.FolderBrowserDialog` を開いている。.NET Framework 上の
このダイアログにモダン表示のモードは無い。報告者の指摘どおり。

ファイル選択のほうは `OpenFileDialog` で、Vista 以降エクスプローラー型で描かれている。
**フォルダ選択だけが取り残されていた。**

## 採る解

issue の案B。シェル自身の `IFileOpenDialog` を `FOS_PICKFOLDERS` で開く。

案A（`pwsh` を使う）を採らない理由: PowerShell 7 は Windows 11 に標準で入っていないので、
「PS7 を入れている人だけ直る」修正になる。報告者の環境で直る保証が無い。

## 設計上の要点

1. **メンバーの宣言順が vtable そのもの。** COM はスロットで呼ぶので、1 つ動かすと別の関数が
   呼ばれる。`IFileDialog` / `IShellItem` の全メソッドを MSDN の順で宣言する（このコードで
   使わないものも含めて）。「使っていないから削る」が事故になる。
2. **失敗の落ち先を作る。** 実装者は Windows で検証できない。interop を try/catch で包み、
   失敗したら従来の `FolderBrowserDialog` に落ちる。フラグ違い、Add-Type がコンパイルできない
   環境、ロックダウンされたランタイム —— どれもモダンなダイアログを失うだけで、
   「フォルダを選べない」にはならない。
3. スクリプトは `server/files/win-folder-dialog.ts` に分ける。`pick-file.ts` に 70 行の C# を
   埋めると、プラットフォーム分岐が読めなくなる。

## テスト

対話ダイアログなので CI では動かせない。固定できるのは `pickFileCommand` が返す argv:

- CLSID_FileOpenDialog と `0x20`（FOS_PICKFOLDERS）が入っている
- `FolderBrowserDialog` が **catch の中にだけ**ある
- `IFileDialog` の主要メンバーが宣言順に並んでいる（vtable 依存の回帰防止）
- here-string の終端 `'@` が行頭にある（prettier の整形で崩れると全体が構文エラーになるが、
  ほかのテストは何も言わない）

## 実機確認

macOS では確認できない。**PR で報告者に確認を依頼する。** それまでマージしない。
