---
name: structural-capacita
description: Capacita（structural-mcp の Capacita サブモジュール。RC 計算コア RcDan、アプリ WebDanforCS、旧名 WebDan・WebDan2）で RC 断面照査を行うときに使う。WDJ（.wdj）を MCP の webdan_inspect／webdan_validate／webdan_compose_wdj／webdan_calculate で読む・検証する・変える・計算する、Headless runner の run-rc を直接呼ぶ（--pickup で .pik などの断面力を取り込む、計算書の節ごとのページ範囲 summary.reportSections）、断面力入力モード（pickup_filename が空）の WDJ を書く、断面力0で飛ばされる照査（WD-1901〜1913）や WD-408〜410 の警告、WD-1001「有効な算出点がありません」・WD-9999・WDJ-FORMAT-CONFLICT・IMPORT-EXISTING-POINT-IDENTITY で失敗するとき、旧 WebDan の WDJ を今の Capacita で読む・計算するとき、側方鉄筋の既定の配置、疲労の繰返し回数、安全係数、計算書のページを画像にして確かめるときにも使う。tool ID と環境変数の webdan は旧名で、変えない。
---

# Capacita で RC 断面照査を行う

Capacita（RcDan／WebDanforCS）は WDJ（JSON）の部材・着目点・配筋・断面力・計算条件から RC 断面照査を行い、計算書（PDF か Markdown）を作る。structural-mcp は Capacita を submodule として版を固定し、`WebDanforCS.Headless` を runner として MCP に公開している。

- 旧名：`webdan`／`webdan2`／`STRUCTURAL_MCP_WEBDAN_RUNNER` は Capacita のこと（互換のため残している。変えない）。
- ソース（開発機のみ。structural-mcp の repo のルートから）：`Capacita/RcDan/`（計算）、`Capacita/WebDanforCS/Headless/`（runner）。runner の契約（引数、`--pickup`、`reportSections` の節の ID）は `Capacita/README.md` の「Headless runner の run-rc」を正とする。
- 照査の式・表・印字桁は Capacita の責務。足りなければ Capacita 側を直す（`references/develop.md`）。
- 確認した版：Capacita a29c9b4（run-rc に `--pickup` と節ごとのページ範囲を足した版）、2026-10-18〜19。

## MCP で使う（先にこちら）

1. `get_capabilities` で `capacita` が使えるかを見る。runner の場所は `get_environment_template`（`engine: "capacita"`）か環境変数 `STRUCTURAL_MCP_WEBDAN_RUNNER`。
2. `webdan_inspect`（WDJ を RcDan のモデルで読み、部材・算出点・配筋・材料・断面力・計算条件を正規化して返す）・`webdan_validate`（構造・参照・選択・主要な重複項目の整合）で中身を確かめる。
3. 変えるときは `webdan_compose_wdj`（明示した意味の変更を適用した `generated.wdj` を job に作る。入力元は上書きしない。不足する設計条件は推測しない）。
4. `webdan_calculate`（`outputFormat: pdf|markdown`）で計算する。`result.json` には照査値も OK/NG もない（`engineeringStatus` は `not_evaluated`）。判定は計算書のページで見る。
- MCP の `webdan_calculate` は `--pickup` を公開していない（`src/server.ts`、2026-10-19）。断面力データ（`.pik`・`.csv`・MIDAS の `.xlsx`）を取り込んで計算するときは runner を直接呼ぶ。

## runner を直接呼ぶ（--pickup、スクリプトから使うとき）

```powershell
dotnet "<runner の .dll>" run-rc --input <model.wdj> --output-dir <空のフォルダー> [--output-format pdf|markdown] [--pickup <断面力データ>] [--summary-xlsx true]
```

- stdout は protocol v1 の envelope。メッセージは `\uXXXX` なので Python などで読む。
- 成果物は `result.json`、`report.pdf`（Markdown なら `report.md`）、選択時の `summary.xlsx`、`--pickup` のときだけ `model.wdj`（取り込んだ WDJ。GUI が保存するのと同じバイト列で、GUI で開ける）。`--pickup` なしでは `model.wdj` は返らない。
- `--pickup` は GUI の「断面力データ取込」と同じコード（`PickupImporter`）。ファイルがなければ `pickup_not_found`、取り込めなければ `pickup_import_failed`（どちらも終了コード 2 で何も書かない）。
- `summary.reportSections`：PDF のとき、計算書の節ごとのページ範囲を先頭ページの順に `{id, firstPage, lastPage}`（1始まり、両端を含む）で返す。何も印刷しなかった節は含まない。節の ID の表は Capacita の README。計算書を節ごとに切り分けて他の帳票に差し込む利用者との契約なので、ID を変えるときは利用者に知らせる。
- 着目点の番号の付け方と、断面力入力モード（`--pickup` なし）の WDJ は `references/wdj.md`。

## WDJ の落とし穴（2026-10-18、本物の runner で確認）

- **旧 WebDan の WDJ はそのままでは計算できないことがある。** `members[].shape` が `"矩形"` のような文字だと、RcDan は 1〜4 の番号しか読まず（`MemberGroup.cs`、1＝矩形）、断面のない部材として飛ばして「有効な算出点がありません」（WD-1001）で失敗する。試すときは複製の `shape` を `"1"` にする。
- **整数の項目は JSON の整数で書く。** RcDan は b・h・鉄筋径・ε'csd・環境条件を int で読み、`300.0` は内部エラー WD-9999 になる。
- **RC の WDJ に `steel` キーがあると拒否される**（WDJ-FORMAT-CONFLICT）。旧 WebDan の WDJ にはある。
- **せん断スパン `shear[].La` は mm で書く。** m の値を書いてもエラーにならず、極端に小さいせん断スパン比で計算されて耐力を過大に見積もる。`La: 1` は「自動算定」の意味（`references/wdj.md`、2026-10-19 に本物の runner で確認）。
- **`--pickup` で取り込むなら `bar[].position` を書かない。** 取込みは着目点の `position` と照合し、`"6.250"` のような値は不一致になる。
- `calc.print_section_force_checked: true` で断面力一覧表（曲げ・せん断の2頁）が先頭に付く（節 `section_forces`）。断面力入力モードでは効かない。
- `conditions_list`（JR-001・JR-004）は RcDan が読むが計算に使わない。入力しても結果は変わらない。
- 安全係数表：復旧性（損傷）地震時以外の γi は運輸機構・JR各社 1.2、JR東日本だけ 1.0（WebDanforJS の `safety-factors-material-strengths.service.ts` の例外に合わせた）。
- 旧 WebDan で作った計算書と今の Capacita では耐力が少し違うことがある（同じ WDJ を今の Capacita で計算しても同じ差が出るので、旧 WebDan との違い。照査値は一致した例がある）。

## 断面力0で飛ばされる照査（WD-1901〜1913）

RcDan（`VerificationControl.CheckValidation`）は断面力0の照査の節を作らず、info のメッセージで知らせる（コードは `ErrorMessage_1000_1999.cs` の `ZeroForce_RailH16_*`、H16 はどの機関も共通）。

| コード | 飛ばす照査 | 条件 |
|---|---|---|
| WD-1901 | 使用性の曲げ | 永久作用の Md＝0 かつ引張軸力なし |
| WD-1902 | 安全性（破壊）の曲げ | |
| WD-1903 | 安全性（疲労）の曲げ | |
| WD-1904 | 復旧性の曲げ | |
| WD-1905 | 復旧性 地震時の曲げ | |
| WD-1906 | 耐久性のせん断 | 永久＋変動の Vd＝0 |
| WD-1907 | 安全性（破壊）のせん断 | |
| WD-1908 | 復旧性のせん断 | |
| WD-1909 | 復旧性 地震時のせん断 | |
| WD-1910 | 耐久性のねじり | |
| WD-1911 | 安全性のねじり | |
| WD-1912 | 復旧性のねじり | |
| WD-1913 | 復旧性 地震時のねじり | |

- 耐久性の曲げは省略しない（全断面圧縮なら「省略判定」として頁を出す）。
- 左右対称の永久作用（例：橋脚の直角方向）では 1901・1906 が出る。
- 断面力入力モードで与えない限界状態の照査は、WD-19xx ではなく warn の WD-408（曲げ）／WD-409（せん断）／WD-410（ねじり）で、印刷されず `reportSections` にも出ない。

## 配筋の既定と数え方

- `side_cover`・`side_ss` を空欄にすると、RcDan（`DefaultValue.CalcDefaultUedgeAndPitchForSideBar`）が上下の主鉄筋の間に側方鉄筋を等分し、側方の芯かぶりを主鉄筋の芯にする。
- **安全性（破壊）の曲げは側方鉄筋を数えない**（Ase「-」。旧 WebDan も同じ）。復旧性の曲げは数える。

## 詳しく

- `references/wdj.md`：`--pickup` の着目点の番号、断面力入力モードの WDJ（`force[]`・`shear[]`・La・返る節）、疲労の繰返し回数、上側鉄筋なし、他のエンジンの PIK を渡すとき。
- `references/develop.md`：手で試す手順（ページを画像にする）、Capacita を直すときのビルドとテスト。

## 知見を足すとき

- Capacita そのものの性質（WDJ の項目、runner の挙動、照査の省略、版による違い）：このスキル（structural-mcp の `skills/structural-capacita/`）を編集し、structural-mcp で commit する。開発機ではインストール先がこのフォルダーへのジャンクションなので、そのまま全案件に効く。
- WebPier が WDJ を書く・計算書に差し込む実装、決定、受入：WebPier の repo のスキル `webpier-capacita`。
- 案件の判断・見本の読み替え：その案件の repo。インストール先がコピー（MSI の利用者）のときは編集しない。
- コードで確かめたこと、実アプリで試したこと、推定を区別し、日付と Capacita の版を残す。
