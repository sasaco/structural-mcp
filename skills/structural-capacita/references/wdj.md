# WDJ：着目点の番号と断面力入力モード

ソースは開発機のみ（structural-mcp の repo のルートから `Capacita/`）。

## --pickup の着目点の番号（2026-10-18、本物の runner で確認）

- Capacita の取込みは、PIK の最初のピックアップ・着目力の行の順に 1 から番号を付け、WDJ の `points`・`bar`・`crack` の `index` と厳密に照合する（`IMPORT-EXISTING-POINT-IDENTITY`。番号を決め打ちすると `IMPORT-EXISTING-POINT-IDENTITY /points/0/p_id` で止まる）。
- FEMPython の `.pik` は部材順に ITAN・（部材荷重の区間の端の途中点 `1`, `2`…）・JTAN を並べる。部材荷重の区間の端があると途中点が増え、同じ部材の端の番号がずれる（例：途中点がなければ6の点が、柱に風荷重の区間の端があると7になる）。番号は PIK の並びから求める。
- 返る完成の WDJ（`model.wdj`）は PIK の全着目点を持ち、`points` の番号は PIK の順（先頭は 1）。
- Aggre-SE のピックアップ（`pickup.pik`）は行の書式は FEMPython の PIK と同じだが、先頭行が `Batch ver1.0.0`、部材の番号は JRSNAP の骨組（NDU の MemberInfo）、着目点は各部材の ITAN・JTAN だけ（スキル `structural-aggrese`）。Capacita に渡すなら、WDJ の着目点をその骨組から求め直す必要がある。

## 断面力入力モード（`--pickup` なし、2026-10-19、本物の runner で確認）

- `pickup_filename` を空にすると Manual モード（`RcConditionEditor.ConditionInputMode`）。Capacita は WDJ の断面力をそのまま計算して `result.json`・`report.pdf` を返す（`model.wdj` は返らない）。
- 断面力は `force[]` の行に `Md<id>_Md`・`Md<id>_Nd`・`Vd<id>_Vd`・`Vd<id>_Md`・`Vd<id>_Nd`、ねじりは `Mt<id>_Mt`・`Mt<id>_Md`・`Mt<id>_Vd`。`id` は `basic.pickup_moment`／`pickup_shear_force` の id（確かめたもの：0 耐久性 応力度、1 耐久性 永久荷重、5 安全性 破壊、7 復旧性 地震時、8 最小鉄筋量。ほかの id の意味は WDJ の `basic` の表で確かめる）。`no` は null でよい。
- 正の Md が下側引張（`rebar2`）、負が上側引張。
- 返る節は断面力表の行で決まる。並びは bending/shear/torsion_safety_destruction、bending/shear_safety_fatigue、bending/shear/torsion_durability、（外観の照査を行えば bending_serviceability）、bending/shear/torsion_restorability、bending/shear/torsion_restorability_eq。`section_forces` は `print_section_force_checked: true` でも出ない。
- 断面力の欠けた行は warn の WD-408/409/410（例：最小鉄筋量 Md8 を空欄にすると WD-408 が1つ出る）。
- **せん断スパンは `shear[]` の行の `La`**（`index`・`m_no`・`p_name`・`g_name` で着目点に結び付く）。`points[].La` は今の RcDan では読まない（旧 WebDan の WDJ にはある）。単位：RcDan のコードは m（`OrganizedInputData/MemberGroup.cs:367` の「せん断スパン長(m)」）。mm で書いた例でも見本の値が再現したという記録があり、単位の扱いは**未確認**（2026-10-19、コードで確認したのはコメントまで）。
- **La は着目点ごとに1つ**なので、限界状態ごとに La を変えるには着目点を分ける。各節はその節の断面力を持つ点だけを印刷する（1点だけの表になる）。旧 WebDan は照査ごとの La を持っていた。
- 上側鉄筋なしは `rebar1` を全部 null（`enable` は true のまま）で通る。
- 疲労は WDJ の `fatigues`（`train_A_count`・`train_B_count`・`service_life` は文字列、`fatigue_list[0]` の M1/V1 に SA・SB・NA06・NB06・NA12・NB12・r1）から Capacita が ΣN を計算する（`RcDan/Calculation/Calc_NRepetition.cs`）。外部プログラム（N-EQUIVALENT など）で求めた値を使う見本と比べるときは、その入力を写す。
