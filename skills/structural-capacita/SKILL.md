---
name: structural-capacita
description: Capacita（structural-mcp の Capacita サブモジュール。RC 計算コア RcDan、アプリ WebDanforCS、旧名 WebDan・WebDan2）で RC 断面照査を行うときに使う。WDJ（.wdj）を MCP の webdan_inspect／webdan_validate／webdan_compose_wdj／webdan_calculate で読む・検証する・変える・計算する、設計衝撃係数（固有振動数 n・速度パラメータ α・iα・ic・i、VePP-I の計算）を webdan_impact か runner の run-impact で求める、Headless runner の run-rc を直接呼ぶ（--pickup で .pik などの断面力を取り込む、計算書の節ごとのページ範囲 summary.reportSections）、断面力入力モード（pickup_filename が空）の WDJ を書く、断面力0で飛ばされる照査（H16 の WD-1901〜1913、R5 の WD-1914〜1926）や WD-408〜410 の警告、R5 の最小鉄筋量・最大鉄筋量（bending_rebar_amount）、WD-1001「有効な算出点がありません」・WD-9999・WDJ-FORMAT-CONFLICT・IMPORT-EXISTING-POINT-IDENTITY で失敗するとき、旧 WebDan の WDJ を今の Capacita で読む・計算するとき、側方鉄筋の既定の配置、疲労の繰返し回数、安全係数、計算書のページを画像にして確かめるときにも使う。tool ID と環境変数の webdan は旧名で、変えない。
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
dotnet "<runner の .dll>" run-rc --input <model.wdj> --output-dir <空のフォルダー> [--output-format pdf|markdown] [--pickup <断面力データ>]
```

- stdout は protocol v1 の envelope。メッセージは `\uXXXX` なので Python などで読む。
- 成果物は `result.json`、`report.pdf`（Markdown なら `report.md`）、選択時の `summary.xlsx`、`--pickup` のときだけ `model.wdj`（取り込んだ WDJ。GUI が保存するのと同じバイト列で、GUI で開ける）。`--pickup` なしでは `model.wdj` は返らない。
- `--pickup` は GUI の「断面力データ取込」と同じコード（`PickupImporter`）。ファイルがなければ `pickup_not_found`、取り込めなければ `pickup_import_failed`（どちらも終了コード 2 で何も書かない）。
- `summary.reportSections`：PDF のとき、計算書の節ごとのページ範囲を先頭ページの順に `{id, firstPage, lastPage}`（1始まり、両端を含む）で返す。何も印刷しなかった節は含まない。節の ID の表は Capacita の README。計算書を節ごとに切り分けて他の帳票に差し込む利用者との契約なので、ID を変えるときは利用者に知らせる。
- 鋼管杭とフーチングの結合部の設計曲げ耐力 Mu は別の命令 `run-pile-joint --input <json> --output-dir <空のフォルダー>`（VePP-HS の HsCalc、鉄筋差込み方式。入力は鋼管・鉄筋・中詰めコンクリート・安全係数・行ごとの軸力 N'd。f'cc・ε'cu は HsCalc が求めるので渡さない）。成果物は `result.json` だけで、`engineeringStatus` は常に `not_run`。契約は `Capacita/README.md` の「Headless runner の run-pile-joint」を正とする。WebPier の 0612・0622 が呼ぶ。
- 着目点の番号の付け方と、断面力入力モード（`--pickup` なし）の WDJ は `references/wdj.md`。

## 設計衝撃係数（webdan_impact／run-impact、2026-10-26、Capacita 43b6463 の本物の runner で確認）

- VePP-I 5.0-L03 の CmnDI（`CalcFrequency`・`CalcImpactCoeff`）と表 `Table\EA.txt`・`BOGIE.txt`・`RENSET.txt` を `Capacita/ImpactSolver/` に取り込んだもの。VePP-I のインストールは要らない。契約は `Capacita/README.md` の「Headless runner の run-impact」を正とする。
- 入力は `rows` に部材を並べた JSON。`model` は `cantilever`（ρAℓ と先端の集中重量 m）・`fixedBoth`（換算等分布荷重 ρA）・`fixedPlate`（四辺固定スラブ、a≦b≦3a、ρh）の3つだけ。E は kN/mm2、I は m4。**質量は呼び出し側が死荷重から求める**（VePP-I の荷重の表と換算は持たない）。断面と配筋から EI を求める機能もない。
- `vehicle` は `EA`・`BOGIE`・`RENSET`。BOGIE・RENSET は `lv`（車両長）が必須、EA では入力エラー。
- 返す値は丸めない（ω・n・α・表を引いたスパン・iα・ic・i）。複線の低減（1−Lb/200）と 3/4 倍は VePP-I にないので呼び出し側。
- iα は VePP-I の表どおり、Lb が表の列の間なら**両側の列の大きいほう**を取る。付属資料4の図を手で読んだ値（近い列や 0 と読む）と違うことがある（例：Lb 5.000・α 0.024 で 0.0295、Lb 7.861・α 0.059 で 0.0238）。
- Capacita 43b6463 より前の runner は、失敗の envelope の engine が `webdan2-headless` で `summary` もなかったため、MCP や engine を確かめる呼び出し側では入力エラーの本文が「unexpected engine」「protocol v1 違反」に隠れていた。

## WDJ の落とし穴（2026-10-18、本物の runner で確認）

- **旧 WebDan の WDJ はそのままでは計算できないことがある。** `members[].shape` が `"矩形"` のような文字だと、RcDan は 1〜4 の番号しか読まず（`MemberGroup.cs`、1＝矩形）、断面のない部材として飛ばして「有効な算出点がありません」（WD-1001）で失敗する。試すときは複製の `shape` を `"1"` にする。
- **整数の項目は JSON の整数で書く。** RcDan は b・h・鉄筋径・ε'csd・環境条件を int で読み、`300.0` は内部エラー WD-9999 になる。
- **RC の WDJ に `steel` キーがあると拒否される**（WDJ-FORMAT-CONFLICT）。旧 WebDan の WDJ にはある。
- **せん断スパン `shear[].La` は mm で書く。** m の値を書いてもエラーにならず、極端に小さいせん断スパン比で計算されて耐力を過大に見積もる。`La: 1` は「自動算定」の意味（`references/wdj.md`、2026-10-19 に本物の runner で確認）。
- **`--pickup` で取り込むなら `bar[].position` を書かない。** 取込みは着目点の `position` と照合し、`"6.250"` のような値は不一致になる。
- `calc.print_section_force_checked: true` で断面力一覧表（曲げ・せん断の2頁）が先頭に付く（節 `section_forces`）。断面力入力モードでは効かない。
- `conditions_list`（JR-001・JR-004）は RcDan が読むが計算に使わない。入力しても結果は変わらない。
- 安全係数表：行6（H16 の復旧性（損傷）地震時以外、R5 の使用性（損傷））の γi は運輸機構・JR各社 1.2、JR東日本だけ 1.0（WebDanforJS の `safety-factors-material-strengths.service.ts` の例外に合わせた）。WebDanforJS の `default_safety_factor` は H16 と R5 で同じ値で、違うのは行6 の名前だけ（コードで確認、2026-10-21）。
- 旧 WebDan で作った計算書と今の Capacita では耐力が少し違うことがある（同じ WDJ を今の Capacita で計算しても同じ差が出るので、旧 WebDan との違い。照査値は一致した例がある）。

## 断面力0で飛ばされる照査（H16 は WD-1901〜1913、R5 は WD-1914〜1926）

RcDan（`VerificationControl.CheckValidation`）は断面力0の照査の節を作らず、info のメッセージで知らせる（コードは `ErrorMessage_1000_1999.cs` の `ZeroForce_RailH16_*`・`ZeroForce_RailR5_*`、どちらもどの機関も共通）。**基準でコードが違う**ので、省略を節と照合する側（WebPier など）は基準に合わせる。H16 のコードのまま R5 の WDJ を照合すると、省略の欠けを説明できずに止まる。

H16（id 0・1・2）：

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

R5（id 3・4・8。`ErrorHelper.ErrorZeroForce` の R5 の分岐、コードで確認 2026-10-21。1914・1919 は本物の runner でも確認）：

| コード | 飛ばす照査（節 ID） | 条件 |
|---|---|---|
| WD-1914 | 使用性（外観）の曲げ（`bending_serviceability`） | 永久作用の Md＝0 かつ引張軸力なし |
| WD-1915 | 安全性（破壊）の曲げ（`bending_safety_destruction`） | |
| WD-1916 | 安全性（疲労破壊）の曲げ（`bending_safety_fatigue`） | |
| WD-1917 | 使用性（損傷）の曲げ（`bending_restorability`） | |
| WD-1918 | 復旧性（損傷）の曲げ（`bending_restorability_eq`） | |
| WD-1919 | 耐久性のせん断（`shear_durability`） | 永久＋変動の Vd＝0 |
| WD-1920 | 安全性（破壊）のせん断（`shear_safety_destruction`） | |
| WD-1921 | 使用性（損傷）のせん断（`shear_restorability`） | |
| WD-1922 | 復旧性（損傷）のせん断（`shear_restorability_eq`） | |
| WD-1923 | 耐久性のねじり（`torsion_durability`） | |
| WD-1924 | 安全性（破壊）のねじり（`torsion_safety_destruction`） | |
| WD-1925 | 使用性（損傷）のねじり（`torsion_restorability`） | |
| WD-1926 | 復旧性（損傷）のねじり（`torsion_restorability_eq`） | |

- 耐久性の曲げは省略しない（全断面圧縮なら「省略判定」として頁を出す）。
- R5 の最小鉄筋量（`bending_rebar_amount`）に断面力0の省略のコードはない（Nd＝0 でも計算する。下の「R5 の最小鉄筋量と最大鉄筋量」）。
- 左右対称の永久作用（例：橋脚の直角方向）では H16 は 1901・1906、R5 は 1914・1919 が出る。
- 断面力入力モードで与えない限界状態の照査は、WD-19xx ではなく warn の WD-408（曲げ）／WD-409（せん断）／WD-410（ねじり）で、印刷されず `reportSections` にも出ない。

## 令和5年の基準（R5_Rail など）で使うとき（2026-10-19、Capacita a29c9b4 の本物の runner で確認）

- `basic.specification2_list` で id 3（R5_Rail）を選ぶ。R5 では行6（`pickup_*` と `safety_factor` の id 6）が**使用性（損傷）**、行7が**復旧性（損傷）**（H16 の「地震時以外」「地震時」に当たる行）。行7 の節の ID は `bending/shear_restorability_eq` のまま（README の表）。
- `crack[].con_u`・`con_l`・`con_s` は R5 では**水掛かりの程度**：1 常時乾燥・2 乾湿繰返し・3 常時湿潤（`EnvironmentCondition.ConvertToEnvType`。H16 では 1 一般・2 腐食性・3 特に厳しい）。σsl・σsl2 は乾燥・湿潤 140、乾湿繰返し 120。Wlim は乾燥 0.005c、乾湿繰返し・湿潤 0.004c。計算書の行「水掛かりの程度」に出る。
- 耐久性の節（`bending_durability`・`shear_durability`）は、**永久作用の行（`pickup_moment`・`pickup_shear_force` の id 1）が無いと出ない**（行0 だけでは info も warn も出ずに節ごと消える）。せん断の変動作用の行（id 2）は空でよい（`CalcResult_ShearCrack` が行0−行1 の差で作る）。
- `safety_factor` の `V_rbv` は Vdd の γb（`S_Gamma_bd`、Capacita の既定 1.2）。Vwcd の γb は別（計算書では Vcd・Vwcd・Vdd の γb 欄に V_rbc が出る）。
- 照査値と OK/NG の総括表 `summary.xlsx` は WDJ の `calc.print_summary_table_checked: true` で返る（成果物 kind `spreadsheet`）。`--summary-xlsx` という引数は runner に無い（付けても無視される）。計算書の節は変わらない。
- `summary.xlsx` の並び（2026-10-21、断面力入力の版の照査で確認）：シートは `Sheet1` だけ。2〜4行目が列見出し（`g_name`・`No<m_no>`・`p_name`）、A〜D 列が照査項目の階層（結合セルの続きは空）、E 列が単位、F 列以降が着目点。照査値のセルは `OK (0.425 ≦ 1.0)`・`OK (省略)` のような文字列で、数値のセルも文字列、記号の後ろに NBSP、鉄筋の行の改行は `_x000A_`。openpyxl（`data_only=True`）で読んで `NG` で始まるセルを探し、`(OK|NG) \(([0-9.]+)` で照査値を取ると、変更前後の NG の数と最大の照査値を比べられる。
- 対称な配筋（上下が同じ）では、着目断面力が小さいほうの引張側を飛ばす info（WD-16xx。確認したのは 1618・1619・1622・1625・1628）が出る。照査の省略（WD-19xx）ではない。
- `members[].g_name` は各頁の右上に `[g_name]` で出る。1つの計算書に複数の骨組の計算書を並べるときは、名前に骨組を入れると頁を区別できる。
- 行6（使用性（損傷））の節は `bending_restorability`・`shear_restorability`・`torsion_restorability`、見出しは「使用性（損傷）曲げモーメントの照査結果」など。行7 は `*_restorability_eq` で「復旧性（損傷）…」（JR各社・運輸機構・JR東日本とも。コードで確認、2026-10-21）。
- `--pickup` で行0・1・5・6・8 と外観を与えたときの節の並び（2026-10-21、本物の runner で確認）：`section_forces`、`bending/shear_safety_destruction`、`bending/shear_durability`、`bending_serviceability`、`bending/shear_restorability`、`bending_rebar_amount`。
- **使用性（外観）**：`crack[].vis_u`（上側）・`vis_l`（下側）を true にした面だけ、`bending_serviceability`（「使用性（外観）曲げひび割れの照査結果」）に出る。断面力は行0（縁応力度）と行1（永久作用）、印字はその面の引張側の点だけ（σct/σbl など）。両方 false なら節は出ない。`crack[].wlimit`（GUI が 0.3 を書く）は RcDan が読まない（コードで確認）。
- **鉄筋の題**：`bar[].rebar1.title`・`rebar2.title` は計算書の各表の「引張側」の欄にそのまま出る（例：上側を「外側」、下側を「内側」にすると、負の Md の点に「外側」と出る）。断面力の符号と面の対応を頁で確かめるのに使える。題は計算に使われない。

### R5 の最小鉄筋量と最大鉄筋量（`bending_rebar_amount`、2026-10-21、Capacita 5104588 で確認）

- 行8「最小鉄筋量」の断面力（断面力入力モードでは `Md8_Md`・`Md8_Nd`、`--pickup` では `pickup_moment` の id 8 の `no`）から、R5 系（id 3・4・8）は同じ節に2つの表を新しいページから印刷する。H16 系は Mcrd/Myd の表だけで変わらない。
- 「最小鉄筋量の照査結果」：Mcrd/Myd の行（ρm 1.3、γc 1.0・γs 1.0・γb 1.1 固定）に続けて、軸方向力の最大値から定まる最小鉄筋量 As ≧ 0.008Ac の行（N'd・f'ck・γc・f'cd・f'yd・kc・γi・γb・Ac・0.008Ac・As・0.008Ac/As）。Ac＝γi·γb·N'd/(kc·f'cd＋0.008f'yd)、kc＝min(1−0.003f'ck, 0.85)。γi 1.0・γb 1.3・γc 1.3・γs 1.0 は固定で、WDJ の安全係数は使わない。N'd は行8 の最大圧縮（引張なら 0）、As は側方鉄筋を含む全軸方向鉄筋。照査結果は Mcrd/Myd と 0.008Ac/As の両方が OK で OK。
- 「最大鉄筋量の照査結果」：pt＝Ast/(b·d) ≦ 0.75pb（行 pt/0.75pb）。pb は釣合状態の式で、σ's は xb＝ε'cu/(ε'cu+εsy)·d の圧縮鉄筋のひずみから Es·ε's（0〜f'syd、圧縮鉄筋がなければ 0）。b は換算矩形の幅（T形はウェブ幅）、γc 1.3・γs 1.0 固定。
- N'd＝0（フーチングなど）でも落ちない：Ac＝0、0.008Ac＝0、0.008Ac/As＝0.000 で OK、pb は N'd の項なし。
- 見本の照合（コードと本物の runner で確認）：N'd 7592.8 kN・f'ck 24・SD390 → Ac 524690.5 mm²・0.008Ac 4197.5 mm²。b 3940・d 1558.4・圧縮鉄筋なし → pb 1.750 %、0.75pb 1.313 %、pt 0.297 %（D38-16）。
- 総括表（`summary.xlsx`）と検討結果一覧の最小鉄筋量は Mcrd/Myd だけ（0.008Ac と最大鉄筋量は計算書の表にだけある）。
- 耐久性（R5）：ひび割れ幅は H16 と同じ式 Wd＝1.1·k1·k2·k3·k4·{4c＋0.7(cs−φ)}·(σse/Es＋ε'csd) で、`crack[].k4` も掛かる。省略判定は σct ≦ σbl かつ σs ≦ σsl（R5 は σs が超えると「省略不可」でひび割れ幅を計算。H16 は「省略判定外」で NG）。σc ≦ 0.4f'cd も同じ節で照査する。
- ひび割れ幅の照査値は Wd/Wlim で、**γi を掛けない**（`RcDan/CalcResult/CalcResult_BendingCrack.cs` の `VerRatio`。H16・R5 共通、コードで確認 2026-10-21、Capacita f385359）。Wlim の c は引張鉄筋1段目のかぶりで、`basic.Limit100`（既定 true）なら 100 mm が上限。計算書の解説に γi·Wd/Wlim と書くと Capacita の値と合わない。

## 配筋の既定と数え方

- `side_cover`・`side_ss` を空欄にすると、RcDan（`DefaultValue.CalcDefaultUedgeAndPitchForSideBar`）が上下の主鉄筋の間に側方鉄筋を等分し、側方の芯かぶりを主鉄筋の芯にする。
- **安全性（破壊）の曲げは側方鉄筋を数えない**（Ase「-」。旧 WebDan も同じ）。復旧性の曲げは数える。

## 詳しく

- `references/wdj.md`：GUI で保存し直した WDJ との比べ方、`--pickup` の着目点の番号、断面力入力モードの WDJ（`force[]`・`shear[]`・La・返る節）、疲労の繰返し回数、上側鉄筋なし、他のエンジンの PIK を渡すとき。
- `references/develop.md`：手で試す手順（ページを画像にする）、Capacita を直すときのビルドとテスト。

## 知見を足すとき

- Capacita そのものの性質（WDJ の項目、runner の挙動、照査の省略、版による違い）：このスキル（structural-mcp の `skills/structural-capacita/`）を編集し、structural-mcp で commit する。開発機ではインストール先がこのフォルダーへのジャンクションなので、そのまま全案件に効く。
- WebPier が WDJ を書く・計算書に差し込む実装、決定、受入：WebPier の repo のスキル `webpier-capacita`。
- 案件の判断・見本の読み替え：その案件の repo。インストール先がコピー（MSI の利用者）のときは編集しない。
- コードで確かめたこと、実アプリで試したこと、推定を区別し、日付と Capacita の版を残す。
