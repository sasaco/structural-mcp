# result.json の読み方と読み戻し

FEMPython eb6d4af、2026-10-30。runner の成果物の一覧は `FEMPython/FrameWebforCS/Headless/README.md`、項目の検査は `FEMPython/FrameWeb/src/fem/result_contracts.py` を正とする。

## 構成

```text
result.json
  schemaVersion: 1, kind: "frameweb_analysis", dimension
  skippedLoadCases: [荷重の行がなく計算から外した荷重ケース]
  analysisResultSet:            AnalysisResultSet v1
    units                       system・length・force・mass・time（解析が単位を名乗らなければ "unspecified"）
    cases[]                     case_id・name・symbol・analysis_type・support_node_ids
    topology
    results[]                   case_id ごと
      node_displacements[]      node_id・components{dx, dy, dz, rx, ry, rz}
      support_reactions[]       support_node_ids の節点だけ。components{fx, fy, fz, mx, my, mz}
      member_section_forces[]   member_id・segments[]{segment_id, station_i, station_j, length, i_end{...}, j_end{...}}
  derived:
    defines[] / combines[] / pickups[]   id・name・displacements・reactions・sectionForces
```

- 荷重ケースごとの部材の断面力は `member_section_forces` の `segments`。部材の i 端の値は最初の区間の `i_end`、j 端の値は最後の区間の `j_end`（WebRamen R1f、本物で確認）。剛域・荷重の端・FEMPython が足した節点で区間が分かれる。
- 組合せ後は `derived.combines[]`（`id` は COMBINE の番号の文字列）の `sectionForces[<mode>]`。mode は `fx_max`・`fx_min`・`mz_max`・`mz_min` など（成分ごとの最大・最小）。各行は `entityId`（部材の番号）・`stationId`（`S0` が i 端）・`components`（その mode で選んだ組合せの全成分の値。fx だけでなく mz なども同じ組合せの値）（WebRamen R1g-b、本物で確認）。
- `derived.pickups[]` は PICKUP ごとに、その COMBINE の中の最大・最小。PIK と PICKUP CSV はこれを書いたもの。
- 値は丸めていない解析の値。印字桁への丸めは読む側で行う。
- FEMPython は部材荷重の区間の端などに節点を足すことがあり、それも `node_displacements` に並ぶ。WebRamen は数字だけの `node_id` を入力の節点として読んでいる（`WebRamen/webramen/export/frameweb.py` の `read_displacements`）。

## 反力に入らないもの

- `support_reactions` は `fix_node` の支点（`support_node_ids`）の反力だけ。**`fix_member` の分布ばね（杭の周面ばねなど）が受け持つ力は入らない**（本物で確認、2026-10-30、WebRamen R1g）。
- そのため周面ばねのある骨組では、反力の和と荷重の和を比べても合わない。つりあいは、柱の軸力の和（鉛直荷重の和と比べる）など、ばねより上の断面の力で確かめる。

## 読み戻して確かめる（入力が読まれたか）

WebPier の `WebPier/webpier/export/frameweb/readback.py` が、書いた FrameWeb の入力と runner の envelope・result.json を比べている（構造解析や照査ではなく、ファイルが書いたとおりに読まれたかの確認）。

- 節点と部材が戻ること（FEMPython が足した節点は除く）。
- 荷重の行のない荷重ケースが外され、項が全部外れた DEFINE が消えること。ほかの荷重ケース・DEFINE・COMBINE・PICKUP は全部戻ること。
- 計算した荷重ケースごとに、支点の反力の水平・鉛直の和が書いた荷重の和とつりあうこと（周面ばねのない骨組。本物の実行では 1e-12 の相対誤差でつりあう）。
- 組合せの鉛直反力（上向き。y が下向きなので −fy）が、係数×書いた荷重（丸めない値）になること。

## PIK

- 2D だけ。行の書式と着目点の並び（部材ごとに ITAN →部材荷重の区間の端の途中点→ JTAN）は、Capacita が読む側としてスキル `structural-capacita`（references/wdj.md）に書いてある。そちらを見る。
