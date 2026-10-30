---
name: structural-fempython
description: FEMPython（structural-mcp の FEMPython サブモジュール。骨組解析エンジン FrameWeb、Headless runner の FrameWebforCS.Headless）で 2D 骨組を解くときに使う。FrameWeb の入力 JSON（node・member・element・rigid・fix_node・fix_member・load・define・combine・pickup）を書く・読む、MCP の fempython_calculate か runner の run で計算して result.json・pickup.pik・report.pdf・PICKUP CSV を得る、荷重図・断面力図だけを PDF にする（load_diagram・section_diagram）、3D の橋面荷重（bridge_loads）の表を PDF にする（bridge_definitions・bridge_loads・bridge_audit）、部材荷重 load_member のマーク（1 集中・2 分布・9 温度・11 集中モーメント）と L1・L2・P1・P2 の意味、収縮を温度荷重で書く、剛域 rigid、支点とばね（0・1・ばね値の意味、長期・短期のばねの組、杭の区間ばね）、作用の組合せ（define の符号の反転、combine の係数、pickup）、符号の規約（y 下向き、軸力 fx は引張が正、節点のモーメント rz、曲げ mz）、result.json の derived.combines の読み方、PICKUP_UNAVAILABLE・PICKUP_REQUIRED・EMPTY_LOAD_CASE_SKIPPED で失敗・警告するとき、杭の周面ばねがあって反力の和が荷重と合わないとき、PIK を Capacita に渡すときの着目点の並びを調べるときにも使う。
---

# FEMPython で骨組を解く

FEMPython（FrameWeb3 のモノレポ）は、Python の FEM エンジン `FrameWeb` と、その .NET クライアント `FrameWebforCS`（画面・印刷）からなる。structural-mcp は FEMPython を submodule として版を固定し、画面を出さない runner `FrameWebforCS.Headless.exe` を MCP の `fempython_calculate` で公開している。runner は FrameWebforCS の**保存 JSON**（以下「FrameWeb の入力」）を受け取り、保存済みの結果は使わずに毎回計算し直し、DEFINE・COMBINE・PICKUP の組合せまで行う。

- ソース（開発機のみ。structural-mcp の repo のルートから）：`FEMPython/FrameWeb/src/`（計算）、`FEMPython/FrameWebforCS/calculation/CalculationRequest.cs`（保存 JSON を計算要求に直す）、`FEMPython/FrameWebforCS/Headless/`（runner。引数・成果物・失敗のコードは同じフォルダーの README.md を正とする）、用語は `FEMPython/GLOSSARY.md`。
- 解析の式・組合せ・印刷は FEMPython の責務。足りないもの・おかしなものは FEMPython の repo で直し、呼び出す側で回避しない（結果の書き換え、代わりの実装はしない）。
- 確認した版：FEMPython 1e653c4（structural-mcp が固定している版。i 端・j 端の集中荷重（マーク 1・11）を断面力に効かせ、runner に橋面荷重の表の節を足した版）、2026-10-30。
- 事実の出どころ：「本物で確認」は本物の runner で解いて確かめたもの（日付と、確かめた案件の段）、「コードで確認」はソースを読んで確かめたもの（実行はしていない）。

## MCP で使う（先にこちら）

1. `get_capabilities` で `fempython` が使えるかを見る。runner の場所は `get_environment_template`（`engine: "fempython"`）か環境変数 `STRUCTURAL_MCP_FEMPYTHON_RUNNER`。runner は FEMPython のチェックアウトの中（`FrameWeb/src` と `FrameWeb/.venv` を上へ辿って探す）に置いたままにする。exe だけを別の場所へ複写しても動かない。
2. `fempython_calculate` に FrameWeb の入力を `input`（JSON の文字列）で渡す。`generatePik`・`generatePdf` は既定 true、`pdfSections` の既定は `input`・`section_force`・`pickup_section_force`・`displacement`・`pickup_displacement`。ほかに 2D の図（`load_diagram`・`section_diagram`・`pickup_section_diagram`）と 3D の橋面荷重の表（`bridge_definitions`・`bridge_loads`・`bridge_audit`）も選べる。`generatePickupDisplacementCsv`・`generatePickupReactionCsv` は既定 false。
3. 成果物は `read_artifact` で読み、バイト数と SHA-256 を確かめてから置く。`engineeringStatus` は常に `not_checked`（解析であって照査ではない）。
- MCP は図の配置・成分（`--load-diagram-*`・`--section-diagram-*`）と用紙の指定を公開していない（`src/fempython-contract.ts`、2026-10-30）。1頁1図・全成分以外が要るときは runner を直接呼ぶ。
- 起動の仕方と成果物の一覧は `fempython_get_runner_contract` でも取れる。

## runner を直接呼ぶ（スクリプトから使うとき）

```powershell
& "<runner の .exe>" run --input <絶対パスの .json> --output-dir <ないか空のフォルダー> `
  [--generate-pdf true|false] [--generate-pik true|false] [--pdf-sections <カンマ区切り>] `
  [--generate-pickup-displacement-csv true|false] [--generate-pickup-reaction-csv true|false] `
  [--pdf-paper A4|A3] [--pdf-orientation vertical|horizontal]
```

- stdout は protocol v1 の envelope 1つ（`engine: "fempython"`）。成功は終了コード 0、失敗は 1 で成果物なし。
- 成果物：`result.json`（いつも）、`pickup.pik`（2D だけ）、`report.pdf`、`pickup-displacement.csv`・`pickup-reaction.csv`（17 列、丸めない値）。
- 荷重図：`--pdf-sections load_diagram`（`--load-diagram-layout single|split_horizontal|split_vertical`、`--load-diagram-axis true|false`、`--load-diagram-single-cases 1,2`）。荷重図だけを頼み PIK・CSV もないときは、Python を起動せず計算もせずに `report.pdf` だけを返す（`result.json` なし、`summary.calculated: false`）。
- 断面力図：`section_diagram`（荷重ケースごと）・`pickup_section_diagram`（PICKUP ごとの最大・最小）。`--section-diagram-components mz,fy,fx,disg`・`--section-diagram-layout`。荷重図と同じ PDF に入れるなら layout をそろえる。
- 計算書に荷重図を差し込む使い方（WebPier・WebRamen）：同じ FrameWeb の入力を `load_diagram` で描かせ、返ったページを自分の計算書に pypdf で挟む。荷重図は FrameWeb に渡した荷重そのものの図になる。FEMPython の PDF のバイトは毎回同じとは限らない。
- 荷重図と断面力図の両方が要るときの分け方（本物で確認、2026-10-30、WebRamen R1g-c）：解く run（`--pdf-sections section_diagram --section-diagram-components mz,fy --section-diagram-layout split_vertical`。result.json と PIK もこの run で得る）と、荷重図だけの run（計算しない）の2回にする。
- `--load-diagram-axis true` の荷重図は、1頁目が軸線図、2頁目から基本ケースごとの頁（本物で確認、同上）。
- `section_diagram` は基本ケースごとの図で、COMBINE の図は出さない（本物で確認、同上）。PICKUP の最大・最小の図は `pickup_section_diagram`。
- 橋面荷重の表（3D）：`bridge_definitions`（パネル・経路）・`bridge_loads`（ケースごとの入力強度と方向）・`bridge_audit`（解析時の荷重分配確認：入力と節点の合力・モーメント、保存誤差、荷重ごとの長さ・面積、等価節点荷重）。3D なので `--generate-pik false`。橋面荷重図は 3D 画面の撮影なので runner からは出ない（本物で確認、2026-10-30、合成桁格子の 12 ケースで 36 頁）。
- 橋面荷重（`bridge_loads`）の書き方・監査のキー・張出しの扱いは、FEMPython の repo の `.claude/skills/headless-runner/SKILL.md` と `FrameWebforCS/tests/data/合成桁格子検証/README.md`（合成桁の設計例との照合の記録）にある。
- 既知の作図の課題：縦に長い骨組（杭が約 22 m で部材の分割が多い）では、荷重図・断面力図の数値の字が重なって読めない所が多い（本物で確認、同上）。直すなら FEMPython の repo で直す。

## 失敗と警告のコード（runner）

| コード | いつ |
|---|---|
| `PICKUP_REQUIRED` | PIK・`pickup_*` の頁・PICKUP CSV を頼んだのに `pickup` が空（コードで確認）。単位荷重を1ケース解くだけの入力では `--generate-pik false` にし、`pickup_*` の頁を外す |
| `PICKUP_UNAVAILABLE` | PICKUP のどれかに計算された断面力（変位の表を頼めば変位）が1つもない。**中身のない荷重ケースを入れると起きた**（本物で確認、2026-10-30、WebRamen R1g）。下の「中身のない荷重ケース」 |
| `EMPTY_LOAD_CASE_SKIPPED`（警告） | 荷重の行が実質ない荷重ケースは計算から外し、`result.json` の `skippedLoadCases` に並べる。0 の結果は作らない |
| `PIK_REQUIRES_2D`・`LOAD_DIAGRAM_REQUIRES_2D`・`SECTION_DIAGRAM_REQUIRES_2D` | 3D の入力で 2D だけの出力を頼んだ |
| `LOAD_DIAGRAM_REQUIRES_LOADS`・`LOAD_DIAGRAM_UNKNOWN_CASE` | 荷重ケースがない、`--load-diagram-single-cases` にない番号 |
| `BRIDGE_LOADS_REQUIRE_3D`・`BRIDGE_LOADS_REQUIRED` | 2D の入力で橋面荷重の表を頼んだ。橋面荷重のあるケースがない（`bridge_definitions` だけならパネルか経路がない） |

### 中身のない荷重ケース

- 外された荷重ケースを参照する DEFINE はその項を失い、項が全部外れた DEFINE は消える。その結果、PICKUP に値が残らないと `PICKUP_UNAVAILABLE` で全体が失敗する（`HeadlessCalculation.cs`・`CalculationDerivedPresenter.cs`、コードで確認）。
- 0 の荷重ケースが要るときの書き方の例：
  - その荷重ケースを書かず、呼び出す側でその断面力を 0 とする（WebRamen の 0600 のスラブの梁。その軌道が届かない片持ちのケース）。
  - 荷重ケースに節点荷重の行を1つだけ `ty: 0` で書く。FEMPython はこのケースを残し、PICKUP は 0 になる（WebPier の荷重モデルの 0 のケース）。

## 符号と座標（確かめた規約）

- **座標**：今の保存形式（`ver` 2 以降）は y が**下向き**が正。FEMPython（FrameWebforCS・Headless・印刷）は保存 JSON をすべてこの向きとして扱う。y 上向きの古い図から書くときは、節点の y、節点荷重の ty・rz、部材荷重の gy の符号を反転して書く（上下を鏡に映した同じ骨組。tx・gx はそのまま）。`ver` を書かないファイルは FrameWebforJS（ブラウザ版）が古い形式として鏡に映すので、ブラウザで開くと上下逆に見える（WebPier ADR-0005、コードと本物で確認）。
- **軸力 fx は引張が正**（本物で確認、2026-10-30、WebRamen R1g-b）。PIK の Fx は圧縮が負で、Capacita が符号を反転して軸力 Nd にする（スキル `structural-capacita`）。
- **節点荷重**：tx は右向き、ty は下向きが正。**モーメント rz は、y を下向きに描いた図で時計回りが正**（本物で確認、2026-10-30、WebRamen R1g-b）。
- **曲げ mz**：i 端を左に置いた水平な梁で、**上側引張り（負の曲げ）が負**（本物で確認、2026-10-26、WebRamen R1f の片持ち梁と両端固定梁）。mz の符号は部材の i→j の向きで決まるので、柱や閉じた骨組では、向きを決めたら符号の分かる小さな骨組（片持ち梁など）で確かめる。閉合骨組の PIK の M の向きの例はスキル `structural-capacita` の references/wdj.md（「FEMPython の PIK を渡すとき」）。
- **分布荷重（マーク 2）の P1 は荷重の始まり（i 端側）の値**、P2 は終わりの値（本物で確認、2026-10-30、WebRamen R1g-b）。

## 部材荷重 load_member のマーク（要点）

| マーク | 荷重 | L1・L2 | P1・P2 |
|---|---|---|---|
| 0 | 無効の行（値が残っていても読まない） | | |
| 1 | 集中荷重 | **どちらも i 端からの距離** | P1 は L1、P2 は L2 に働く**別々の**荷重 |
| 2 | 分布荷重（線形） | L1 は i 端から、**L2 は j 端からの距離** | 始まりの値と終わりの値 |
| 9 | 温度変化 | 使わない | P1＝温度変化（℃）。ひずみは P1×その断面の `Xp` |
| 11 | 集中モーメント | マーク 1 と同じ | マーク 1 と同じ |

- ほかのマークは `unsupported mark` で失敗する（`CalculationRequest.cs`、コードで確認）。
- **収縮は温度荷重で書く**：`Xp`＝1e-5 のとき、収縮ひずみ 150×10⁻⁶ は P1＝−15（℃）。上層梁に収縮 −15 ℃ と温度 −10 ℃ を載せた軸力の比が 1.5 になることで、マーク 9 が効いていることを確かめた（本物で確認、2026-10-30、WebRamen R1g-b）。
- 書き方の細部（方向の名前、複数の部材にまたがる行、mm への丸め、負の距離の扱い、移動荷重の `LL`）は `references/frameweb-json.md`。

## 組合せは FEMPython にさせる

基本ケースを荷重ケース、抽出（符号の反転を含む）を `define`、作用の組合せを `combine`、照査ごとの割当てを `pickup` に書くと、FEMPython が組合せと最大・最小の抽出まで行う。係数は印字した値を書き、FEMPython は丸めずに掛ける（呼び出す側の計算書が作用ごとに丸めた合計とは丸めの分だけ違う）。表の書き方と、荷重ケースごとのばねの組（長期・短期）は `references/frameweb-json.md`。

## 結果の読み方（要点）

- `result.json`：`analysisResultSet`（AnalysisResultSet v1。荷重ケースごとの変位・反力・部材の断面力）と `derived`（`defines`・`combines`・`pickups` の組合せ後の値）、`skippedLoadCases`。
- 組合せ後の断面力は `derived.combines[].sectionForces[<mode>]`（`fx_max`・`fx_min`・`mz_max`・`mz_min` など）。各行は `entityId`（部材）・`stationId`（`S0` が i 端）・`components`（その mode で選んだ組合せの全成分）（本物で確認、2026-10-30、WebRamen R1g-b）。
- **`fix_member` のばね（杭の周面ばねなど）の反力は `support_reactions` に入らない**。周面ばねのある骨組では反力の和で力のつりあいを確かめられないので、柱の軸力の和などで確かめる（本物で確認、2026-10-30、WebRamen R1g）。
- 項目の場所と、読み戻して確かめる方法は `references/results.md`。

## PIK を Capacita に渡す

- `pickup.pik` は 2D だけ。着目点は部材ごとに ITAN →（部材荷重の区間の端の途中点）→ JTAN の順に並ぶ。部材の途中に荷重の端があると途中点が増え、番号がずれる。並びと書式、Capacita の `--pickup` で番号を照合する規則はスキル `structural-capacita`（references/wdj.md の「--pickup の着目点の番号」「自分で解いた骨組の断面力を PIK にして渡す」）を見る。ここには写さない。
- 着目点を部材の端だけにしたいときは、照査する点・荷重の端のすべてに節点を置いて部材を分ける（部材の途中に荷重がなければ FEMPython は点を足さない。WebRamen R1g-b の設計用の骨組）。

## 詳しく

- `references/frameweb-json.md`：FrameWeb の入力の各キー（node・member・element・rigid・fix_node・fix_member・load・define・combine・pickup）、単位、支点の 0・1・ばね値、区間ばね、剛域、部材荷重の細部、移動荷重、WebPier・WebRamen の書き方の例。
- `references/results.md`：result.json の構成、FEMPython が足す節点、つりあいと読み戻しの確かめ方、鉄道の設計計算例の断面力の表との符号の対応（N'・V・M と fx・fy・mz）。

## 知見を足すとき

- FEMPython そのものの性質（入力の項目の意味、符号、runner の挙動、版による違い）：このスキル（structural-mcp の `skills/structural-fempython/`）を編集し、structural-mcp で commit する。
- FEMPython の不具合・機能不足：FEMPython の repo で直す。
- WebPier・WebRamen がこの入力を書く実装と決定：それぞれの repo。案件の判断：その案件の repo。
- インストール先がコピー（MSI の利用者）のときは編集しない。案件側に書いて開発者に伝える。
- 本物で確かめたこと、コードで確かめたこと、推定を区別し、日付と FEMPython の版を残す。
