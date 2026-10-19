# プロジェクトXMLの項目と画面の対応

Batch 5.3.0.1。2026-10-18 にコードで確認。ソースは開発機のみ（structural-mcp の repo のルートから `Batch/Aggre-SE/`）。

## ソースの場所

- クラスは `Batch/Aggre-SE/datas/*.vb`（`InputData.vb` の `Datas` がルート）。
- 画面の文言は `Batch/Aggre-SE/forms/ChildForm*.Designer.vb`、配列の添字と画面の対応は `ChildForm*.vb` の DataLoad/DataSave。
- VB のファイルは **UTF-8（BOM 付き）**で、Shift-JIS なのはプロジェクトXMLだけ（`datas/`・`forms/` の38件で確認）。VB のファイルを `iconv -f cp932` で読まない。

## 項目と画面の対応

| XML | 画面・意味 | 注意 |
|---|---|---|
| `CaseName/dgCaseList_1`〜`_9` | 照査対象 ①復旧性L2 ②安全性L2 ③損傷レベル ④破壊形態 ⑤せん断耐力 ⑥L1 ⑦基礎の安定 ⑧杭の段落し図 ⑨断面力ピックアップ。Case ごとに -1＝チェック | |
| `SNAP/SnapDBPath` | 解析ケースの DB1。XML のフォルダーからの相対パスか絶対パス | ρm・αf は DB1 の中身（`KihonInfo`）から読み、ファイル名から読まない。JRSNAP 5.2 と 5.3 の名付けの違いは問題にならない |
| `Element/_dgLimitLevel_type`・`_La`・`_VydType`・`_SIJI` | 非線形部材（MF＋DL）ごとの部材照査タイプ・せん断スパン La・せん断耐力式（1＝①RC標準）・端部支持条件（-1＝なし）。`dgLimitLevel_typeCount`（先頭に `_` なし）は `_dgLimitLevel_type` の件数を返すプロパティ（`ElementSettingClass.vb:51`） | M-θ 部材の La は DB1 の値で画面が上書きする（編集できるのは 540 の M-φ で L=0 のときだけ） |
| `dgLimitLevel_title`、`_dgLimitLevel`、`_dgLimitLevel2` | 部材照査タイプ1〜5の名前と、損傷レベルの制限値（復旧性・安全性） | |
| `Foundation/基礎照査/clsFoundation` | `FoundationType` 0＝杭基礎、1＝直接基礎。`pointNo` の意味は置き場所で違う：`dgDispAtPoints`（杭基礎）・`dgDispAtPoint`（直接基礎）は変位照査の**節点番号**、杭基礎の `dgReactAtPoint` は反力照査の**要素番号**（`reports/ExcelReport.vb:552-584`）。画面の列「着目番号」の見出しは「要素番号」（`ChildFormFoundationSetting.Designer.vb:300`）だが、直接基礎の計算は節点番号として使う。直接基礎の制限値 `dgLimitValue1`（11件）は空欄なら自動計算 | |
| `Requirement/_rbSpec` | **(0)＝Ⅰ,Ⅱ両方**、(1)＝Ⅰ、(2)＝Ⅱ | 画面の並びと添字が違う |
| `_rbChiiki`、`_rbJIban` | 地域 A・B・C、地盤 G0〜G5（添字0〜5）、(9)＝応答塑性率の直接入力（任意スペクトル） | (9) の μ は XML に入らない。runner には `--spectral-ductility`、MCP には `spectralDuctility` で渡す |
| `_rbEkijo`、`dgEkijoCase*`、`cbM65Area`、`tbAlfa`、`_cbηx` | 液状化 PL、M6.5以上の震源エリア、低減係数α、不整形性 η(x) | |
| `AtPoint` | 着目節点。正の数はその節点。`0` は DB1 の着目点 `JNo` が正ならそれ、そうでなければ増分解析（`KaisekiFlg=1`）なら例外、それ以外は 1。数でない値（空文字を含む）は例外（`reports/CalculationCase.vb:137-156`） | 画面は空文字のとき DB1 の着目点を表示し、保存でその値を書く |
| `Calculation/_rbProduct` | (0)＝標準仕様、(1)＝カスタム仕様 | |
| `Version` | 保存した Batch.exe の FileVersion | `applyVersion` が変換するのは 1.1.0.11 未満だけ |

## 配列の長さ

配列の長さは XML のまま保たれる。新しく作るファイルは `Option_ケース数`（いま50）件。古い見本には101件のものがある。
