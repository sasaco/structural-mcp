# WDJ：着目点の番号と断面力入力モード

ソースは開発機のみ（structural-mcp の repo のルートから `Capacita/`）。

## GUI で保存し直した WDJ（2026-10-21、WebDanforCS 2.5.9 で保存されたもので確認）

利用者がプログラムの出した WDJ を GUI で開いて直し、保存したものを受け取ったときは、**JSON を読んで値ごとに比べる**（テキストの diff は使えない）。GUI の保存で次のものが変わるが、意図した変更ではない。

- 書式：1行の JSON（字下げなし）、`ver` が GUI の版（例 `2.5.9`）、`$schema`・`format`・`schema_version`・`lang` が消える。
- 既定値の補完：`bar[].b`・`h` に部材の B・H、`bar[].position` に文字列の位置（`"0.200"`）、同じ部材の2点目以降の `bar`・`crack`・`fatigue_list`・`shear` の `m_no` が `""`、`rebar1/2.enable` が消える、`crack[].JRTT05: false`・`wlimit: 0.3`、`fatigues.fatigue_list`（着目点ごと）・`service_life: 100`・`train_A/B_count: 0`、`shear[]`（La null の行）、`members[].c_type: 1`・`vo_type: 2`、`safety.axisforce_condition`・空の `component` など、`calc.member_group_selection`（グループごとに Checked）。
- 表の題：`specification1/2_list` の title が日本語（「鉄道標準 令和5年設計標準」）、`pickup_*` の題が GUI の文言（「耐久性 使用性 永久作用」など）。
- `pickup_data` は取り込んだ断面力（PIK の値そのもの。M の符号は変えない）。

意図した変更として見るのは、`basic.pickup_*` の `no`（行と抽出ケースの対応）、`bar[].rebar1/2` の題・径・本数・間隔・かぶり、`crack[]` の `con_*`・`ecsd_*`・`vis_*`、`safety_factor`。題だけを変えて鉄筋や `con_*` が付いてきていないことがあるので、面ごとにそろっているか確かめる（スキル `structural-railway-design` の「骨組の曲げモーメントの符号と、外側・内側の鉄筋の対応」）。

## --pickup の着目点の番号（2026-10-18、本物の runner で確認）

- Capacita の取込みは、PIK の最初のピックアップ・着目力の行の順に 1 から番号を付け、WDJ の `points`・`bar`・`crack` の `index` と厳密に照合する（`IMPORT-EXISTING-POINT-IDENTITY`。番号を決め打ちすると `IMPORT-EXISTING-POINT-IDENTITY /points/0/p_id` で止まる）。
- FEMPython の `.pik` は部材順に ITAN・（部材荷重の区間の端の途中点 `1`, `2`…）・JTAN を並べる。部材荷重の区間の端があると途中点が増え、同じ部材の端の番号がずれる（例：途中点がなければ6の点が、柱に風荷重の区間の端があると7になる）。番号は PIK の並びから求める。
- 返る完成の WDJ（`model.wdj`）は PIK の全着目点を持ち、`points` の番号は PIK の順（先頭は 1）。
- Aggre-SE のピックアップ（`pickup.pik`）は行の書式は FEMPython の PIK と同じだが、先頭行が `Batch ver1.0.0`、部材の番号は JRSNAP の骨組（NDU の MemberInfo）、着目点は各部材の ITAN・JTAN だけ（スキル `structural-aggrese`）。Capacita に渡すなら、WDJ の着目点をその骨組から求め直す必要がある。

## 断面力入力モード（`--pickup` なし、2026-10-19、本物の runner で確認）

- `pickup_filename` を空にすると Manual モード（`RcConditionEditor.ConditionInputMode`）。Capacita は WDJ の断面力をそのまま計算して `result.json`・`report.pdf` を返す（`model.wdj` は返らない）。
- 断面力は `force[]` の行に `Md<id>_Md`・`Md<id>_Nd`・`Vd<id>_Vd`・`Vd<id>_Md`・`Vd<id>_Nd`、ねじりは `Mt<id>_Mt`・`Mt<id>_Md`・`Mt<id>_Vd`。`id` は `basic.pickup_moment`／`pickup_shear_force` の id（確かめたもの：0 耐久性 応力度、1 耐久性 永久荷重、5 安全性 破壊、6 使用性（損傷）（R5。H16 は復旧性 地震時以外）、7 復旧性 地震時、8 最小鉄筋量。ほかの id の意味は WDJ の `basic` の表で確かめる）。`no` は null でよい。
- 正の Md が下側引張（`rebar2`）、負が上側引張。
- 返る節は断面力表の行で決まる。並びは bending/shear/torsion_safety_destruction、bending/shear_safety_fatigue、bending/shear/torsion_durability、（外観の照査を行えば bending_serviceability）、bending/shear/torsion_restorability、bending/shear/torsion_restorability_eq、（行8 があれば）bending_rebar_amount。`section_forces` は `print_section_force_checked: true` でも出ない。
- 断面力の欠けた行は warn の WD-408/409/410（例：最小鉄筋量 Md8 を空欄にすると WD-408 が1つ出る。Md8 を書けば出ない）。
- 行8（最小鉄筋量、`Md8_Md`・`Md8_Nd`）を書くと、R5 では `bending_rebar_amount` が最後の節で 3 頁（最小鉄筋量の照査結果 2 頁、最大鉄筋量の照査結果 1 頁）。`Md8_Nd` が 0（フーチングなど）でも計算する（2026-10-21、Capacita 5104588 の本物の runner で確認。表の中身は SKILL.md の「R5 の最小鉄筋量と最大鉄筋量」）。
- **せん断スパンは `shear[]` の行の `La`**（`index`・`m_no`・`p_name`・`g_name` で着目点に結び付く）。`points[].La` は今の RcDan では読まない（旧 WebDan の WDJ にはある）。
- **La の単位は mm**（2026-10-19、コードと本物の runner で確認）。計算は `CalcResult_ShearCapacity.cs` の「せん断スパン長La(mm)」で、せん断スパン比を `La / 有効高さ d（mm）` で求める。計算書も「せん断スパン長 (mm)」と印字する。読み取り側の `OrganizedInputData/MemberGroup.cs:367` のコメント「せん断スパン長(m)」は誤り。m の値（例：1.55）を書くと 1.55 mm として計算され、せん断スパン比が 0.001 になって βa が上限 5.000 に張り付き、ディープビームの耐力 Vdd を大きく見積もる（例：11134.6 kN が 15179.9 kN に、照査値 0.566 が 0.415 に。安全側でない）。エラーにも警告にもならない。
- **La＝1（ちょうど 1.0）は「自動算定」**（`CommonDataClass.cs` の `ShearVerification`）。そのときは断面力から `|1000 × Md / Vd|`（mm）を使う（`ModelDataForCalc.GetShearSpan`）。旧 WebDan の WDJ の `La: 1` はこの意味。1 mm のつもりで 1 を書かない。`shear` の表がない（La が null）着目点は、せん断スパン比を考えない。
- **La は着目点ごとに1つ**なので、限界状態ごとに La を変えるには着目点を分ける。各節はその節の断面力を持つ点だけを印刷する（1点だけの表になる）。旧 WebDan は照査ごとの La を持っていた。
- 上側鉄筋なしは `rebar1` を全部 null（`enable` は true のまま）で通る。

### 断面力入力で版（スラブ）を照査した例（R5_Rail、2026-10-19、本物の runner で確認）

関内 EVピット部の 0530 底版（四辺固定スラブの近似解法の断面力を1m幅で照査）で確かめたこと。

- 成果物は `result.json`・`report.pdf` と、`calc.print_summary_table_checked: true` なら `summary.xlsx` の3つ（kind `result`・`report`・`spreadsheet`）。照査値と OK/NG はこの総括表と計算書にだけある。与えた WDJ を GUI で開けるので、利用者が控えに残すのはその WDJ。
- 骨組の無い断面だけの照査は、**着目点1つに部材1つ**（`members[].m_no` と `points[].m_no` を同じに、`m_len` は使われない値でよい）、`points[].position` は null、`p_id` は文字列でも通る。`members[].g_name` が各頁の右上に `[x方向]` のように出て、同じ `g_id` の部材が1つの表の列に並ぶ（列見出しは `No<m_no>`・`p_name`・引張側）。
- 曲げだけの点は `isVyCalc: false`。せん断の節にはその点が出ない（せん断の節はグループごとに Part 1・Part 2 の2頁、通し番号は節全体で (1/4)〜(4/4)。曲げは1グループ1頁）。
- せん断の行には `Vd<id>_Vd` と一緒に `Vd<id>_Md`（その点の Md）を書く。計算書の Md 欄と、軸力を考えない曲げ耐力 Mu の比較に使われる。軸力は `_Nd` を null にすると 0.0 と印字される。
- 疲労（id 2〜4）・使用性（損傷）（id 6）・最小鉄筋量（id 8）を空にすると、着目点ごと・行ごとに warn の WD-408（曲げ）／WD-409（せん断）が出る（4点・曲げ点4・せん断点2で24件）。照査の節は欠けない（`reportSections` は与えた行の節だけ）。
- 変動作用の無い構造で耐久性の行0（縁応力度）と行1（永久作用）に同じ値を入れても、耐久性の節は出る。曲げひび割れは σc・σct・σs が制限値以内なら「省略判定 省略」（ひび割れ幅は「-」、総括表は `OK (省略)`）、せん断ひび割れは変動作用0で `OK (省略)`。
- 上向きの荷重を受ける底版の支点部は下面引張なので、「支点部は負」で書かれた断面力（上からの荷重の慣用）を渡すときは Md の符号を反転する（Capacita は正の Md が下側引張）。計算書の「引張側」欄（下側／上側）で確かめられる。
- 疲労は WDJ の `fatigues`（`train_A_count`・`train_B_count`・`service_life` は文字列、`fatigue_list[0]` の M1/V1 に SA・SB・NA06・NB06・NA12・NB12・r1）から Capacita が ΣN を計算する（`RcDan/Calculation/Calc_NRepetition.cs`）。外部プログラム（N-EQUIVALENT など）で求めた値を使う見本と比べるときは、その入力を写す。


### ディープビームのせん断（`shear[].deep_beam`、2026-10-26。RC標準 R5 の 3 基準だけ）
- 杭基礎のフーチングのせん断（見本 設計計算例 第V編 表2.3.10・2.3.11）。`shear[]` の点の要素（`index`・`m_no`・`p_name`）に `deep_beam` を足す。`mode: lower_tension`（く体前面、設計せん断圧縮破壊耐力 Vfdd）は `a1_mm`・`pile_diameter_mm`・`stirrup_b1_mm` が要り、`mode: upper_tension`（杭位置、設計引抜きせん断耐力 Vsd）は `stirrup_count_in_range`（`theta_deg` は省略時 45）が要る。H16 系に付けると WD-411。
- 引張側は `mode` で決まり、点の `isUpperCalc`・`isLowerCalc` と Md の符号は見ない。部材の幅 B が有効幅 be。Vd は `Vd5_Vd`（安全性（破壊）のせん断）の絶対値。この点は通常のせん断照査（斜め引張破壊など）を行わず、節 `shear_deep_beam_safety_destruction`（`shear_safety_destruction` の次、点ごとに 1 ページ）に出る。
- 曲げも同じ点で照査するなら、`isMzCalc` を true にして `Md<id>_Md` を符号つきで書く（`deep_beam` の点でも曲げは Md の符号と `isUpperCalc`・`isLowerCalc` で面が決まる）。曲げなしでせん断だけなら `isMzCalc: false`。
- 見本の丸め：Vfdd は f'cd（小数1桁）・各係数（4桁、pc・pw は5桁）・Vfdd（1桁）を丸めた値で以後を計算する。Vsd の見本 21557.0 は、同じ入力から 21557.8 になる（見本の丸めの違い）。
- 断面力入力モードで曲げの Md0・1・5・7・8 とせん断の Vd5 だけを書くと、Md3・Md4・Md6 と Vd0〜7 の欄がないので WD-408・WD-409 の警告が出る。結果には影響しない（`NoCalc` では消えない）。
