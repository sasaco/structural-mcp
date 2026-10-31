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
- **両端固定 `shear[].fixed_end`・部材長 `L`（Vasud）は、鉄道標準 R5・新幹線 R5 だけ**で使う。JR東日本は H16・R5 とも読まない（R5 は Capacita 1e0213a から。WebDanforJS#740）。JR東日本 R5 は a/d < 2.0 で Vdd を求めず Vydd（＝Vcdd＋Vsdd）を使い、計算書・総括表とも「Vydd」と出す。
- **La は着目点ごとに1つ**なので、限界状態ごとに La を変えるには着目点を分ける。各節はその節の断面力を持つ点だけを印刷する（1点だけの表になる）。旧 WebDan は照査ごとの La を持っていた。
- 上側鉄筋なしは `rebar1` を全部 null（`enable` は true のまま）で通る。

### 断面力入力で版（スラブ）を照査した例（R5_Rail、2026-10-19、本物の runner で確認）

関内 EVピット部の 0530 底版（四辺固定スラブの近似解法の断面力を1m幅で照査）で確かめたこと。

- 成果物は `result.json`・`report.pdf` と、`calc.print_summary_table_checked: true` なら `summary.xlsx` の3つ（kind `result`・`report`・`spreadsheet`）。照査値と OK/NG はこの総括表と計算書にだけある。与えた WDJ を GUI で開けるので、利用者が控えに残すのはその WDJ。
- 骨組の無い断面だけの照査は、**着目点1つに部材1つ**（`members[].m_no` と `points[].m_no` を同じに、`m_len` は使われない値でよい）、`points[].position` は null、`p_id` は文字列でも通る。`members[].g_name` が各頁の右上に `[x方向]` のように出て、同じ `g_id` の部材が1つの表の列に並ぶ（列見出しは `No<m_no>`・`p_name`・引張側）。
- 曲げだけの点は `isVyCalc: false`。せん断の節にはその点が出ない（せん断の節はグループごとに Part 1・Part 2 の2頁、通し番号は節全体で (1/4)〜(4/4)。曲げは1グループ1頁）。
- せん断の行には `Vd<id>_Vd` と一緒に `Vd<id>_Md`（その点の Md）を書く。計算書の Md 欄と、軸力を考えない曲げ耐力 Mu の比較に使われる。軸力は `_Nd` を null にすると 0.0 と印字される。
- 疲労（id 2〜4）・使用性（損傷）（id 6）・最小鉄筋量（id 8）を空にすると、着目点ごと・行ごとに warn の WD-408（曲げ）／WD-409（せん断）が出る（4点・曲げ点4・せん断点2で24件）。照査の節は欠けない（`reportSections` は与えた行の節だけ）。
- 変動作用の無い構造で耐久性の行0（縁応力度）と行1（永久作用）に同じ値を入れても、耐久性の節は出る。曲げひび割れは σc・σct・σs が制限値以内なら「省略判定 省略」（ひび割れ幅は「-」）、せん断ひび割れは変動作用0で `OK (省略)`。総括表の耐久性(曲げ)は、σct・σbl・σct/σbl（`省略 (0.669 ≦ 1.0)`／`省略不可 (1.198 > 1.0)`）の3行があり、ひび割れ幅を検討しないときの wd/wlim は「-」、全断面圧縮は σs/σsl1 の行に `OK (全断面圧縮)`（Capacita b3049c8 から。それより前は wd/wlim に `OK (省略)`）。
- 上向きの荷重を受ける底版の支点部は下面引張なので、「支点部は負」で書かれた断面力（上からの荷重の慣用）を渡すときは Md の符号を反転する（Capacita は正の Md が下側引張）。計算書の「引張側」欄（下側／上側）で確かめられる。
- 疲労は WDJ の `fatigues`（`train_A_count`・`train_B_count`・`service_life` は文字列、`fatigue_list[0]` の M1/V1 に SA・SB・NA06・NB06・NA12・NB12・r1）から Capacita が ΣN を計算する（`RcDan/Calculation/Calc_NRepetition.cs`）。外部プログラム（N-EQUIVALENT など）で求めた値を使う見本と比べるときは、その入力を写す。
- 複線用補正係数 r2 の係数は M1/V1 の `A`（列車分担比 a、空欄なら 1）と `B`（複線載荷確率 b、空欄なら 0）。r2 は a・b のどちらかが 1 なら 1 になる。b の既定は Capacita 8c5e30f で 1 から 0 になった（WebDanforJS#707）ので、A を保存して B が空の WDJ は、それより前の版と結果が変わる。
- 疲労（曲げ）の σsrd は、永久作用と永久＋変動の断面力の組のうち照査比が最大のもの。永久＋変動の曲げモーメントが正負の両方をとる点では、照査する側の永久＋変動に断面力0の状態も入る（その側の鉄筋は0まで下がる。Capacita 9d43599、WebDanforJS#720）。それより前の版は σsrd を小さく出していた。


### ディープビームのせん断（`shear[].deep_beam`、2026-10-26。RC標準 R5 の 3 基準だけ）
- 杭基礎のフーチングのせん断（見本 設計計算例 第V編 表2.3.10・2.3.11）。`shear[]` の点の要素（`index`・`m_no`・`p_name`）に `deep_beam` を足す。`mode: lower_tension`（く体前面、設計せん断圧縮破壊耐力 Vfdd）は `a1_mm`・`pile_diameter_mm`・`stirrup_b1_mm` が要り、`mode: upper_tension`（杭位置、設計引抜きせん断耐力 Vsd）は `stirrup_count_in_range`（`theta_deg` は省略時 45）が要る。H16 系に付けると WD-411。
- 引張側は `mode` で決まり、点の `isUpperCalc`・`isLowerCalc` と Md の符号は見ない。部材の幅 B が有効幅 be。Vd は `Vd5_Vd`（安全性（破壊）のせん断）の絶対値。この点は通常のせん断照査（斜め引張破壊など）を行わず、節 `shear_deep_beam_safety_destruction`（`shear_safety_destruction` の次、点ごとに 1 ページ）に出る。
- 曲げも同じ点で照査するなら、`isMzCalc` を true にして `Md<id>_Md` を符号つきで書く（`deep_beam` の点でも曲げは Md の符号と `isUpperCalc`・`isLowerCalc` で面が決まる）。曲げなしでせん断だけなら `isMzCalc: false`。
- 見本の丸め：Vfdd は f'cd（小数1桁）・各係数（4桁、pc・pw は5桁）・Vfdd（1桁）を丸めた値で以後を計算する。Vsd の見本 21557.0 は、同じ入力から 21557.8 になる（見本の丸めの違い）。
- 断面力入力モードで曲げの Md0・1・5・7・8 とせん断の Vd5 だけを書くと、Md3・Md4・Md6 と Vd0〜7 の欄がないので WD-408・WD-409 の警告が出る。結果には影響しない（`NoCalc` では消えない）。

### ねじりの断面力入力と T 形の Kt（`members[].torsion_flange`、2026-10-31、H16_Rail・Capacita の本物の runner で確認）

- ねじりだけを照査する点：`points[]` を `isMtCalc: true`（曲げ・せん断を照査しないなら `isMzCalc`・`isVyCalc` は false）、`calc.calculate_torsional_moment: true`。断面力は `force[]` の `Mt<id>_Mt`・`Mt<id>_Md`・`Mt<id>_Vd`・`Mt<id>_Nd`（id は曲げ・せん断と同じ：1 耐久性 永久作用、5 安全性（破壊）、6・7 復旧性）。安全性（破壊）の Mtud1・Mtud2 は `Mt5_Md`・`Mt5_Vd` と、同じ点の配筋から求めた Mud・Vyd で求める。Md の符号は曲げと同じ（正が下側引張）。
- 与えない行は warn の WD-410（例：Mt5 だけなら 4 件）。返る節は与えた行のものだけ（Mt5 だけなら `torsion_safety_destruction` の 3 頁）。
- 耐久性のねじりひび割れは、省略の判定（Mthd ≦ 0.7Mtud）に行 0「耐久性 ひび割れ判定」（永久＋変動）、σwpd の照査に行 1（永久作用）の断面力を使う。行 0 を書かないと行 1 で代える（`CalcResult_TorsionCrack.cs`。WD-410 は出る）。Mt1 だけで 3 頁の節 `torsion_durability`（2026-10-31、H16_Rail で確認）。
- 曲げとの組合せの Mtud1・Mtud3 は行の Md だけ、せん断との組合せの Mtud2・Mtud4 は行の Vd だけを使う（Nd＝0 なら Mud・Vyd は他方によらない）。ただし Vd は配筋の行の `tan`（変断面の傾き）で **Vd − Md·tanθ/d に補正してから**使う（`Calc_Vcd` に点の TanForV を渡す）。別々の状態の |Md|・|Vd| の最大を1行に組むときは、`tan` を書かずに補正しない Vd を渡す（大きい |Md| で Vd を小さく見すぎないため）。
- ねじり補強鉄筋の ΣAtl・b0・d0 は Capacita が配筋から求める（`RcDan/General/CommonDataClass.cs` の `TorsionalReBarData`）。ΣAtl は上下の軸方向鉄筋を段ごとに min(上側, 下側)×2（上下対称な分だけ）と側方鉄筋の両側分を数える（RC標準 R5 第III編 2.3.5.5(6) の「上下左右対称に配置する」に合う安全側の読み）。設計計算例 II-277（D32 6本＋D19 2本×2＋D22 4本、帯鉄筋 D22）で ΣAtl 4242.8・b0 709.0・d0 714.2（見本 7459.6・670.0・715.0、見本は非対称な分も数える）、Mtyd 447.9（見本 734.3）。
- b0・d0（最外周スターラップの長さ）の式の鉄筋径の半分は、Capacita `9fdf89d`（2026-10-31）より前は整数の割り算で、D19・D25 など奇数径の鉄筋が効く断面で 0.5 mm 小さく出ていた（上の例の b0 は 708.0）。古い結果と比べるときはこの差を見込む。
- 安全係数は安全性（破壊）の行（id 5）の `V_rc`（γc）・`V_rs`（γs）・`M_rbs`（Mud の γb）・`V_rbc`・`V_rbs`・`T_rbt`（Mtcd・Mtyd・Mtcud の γb）・`ri`。
- **Kt は既定でフランジを無視した矩形**（T形も B×H）。T形・L形の Kt＝Σbi²·di/η1i（RC標準 R5 第III編 表7.7.1、H16 表7.2.2）にするには、部材に `torsion_flange` を書く（Capacita の README の `members[].torsion_flange`）：
  - `left_overhang_mm`・`right_overhang_mm`：左右の突縁の張出しの**上限**（片持ち部は張出し長さ bc、中間部は主梁の内側面間距離の半分 bs/2。0 はその側になし）。有効幅 λt＝min(3·t, 上限)（R5 第III編 式(7.7.30)）は Capacita が決めるので、3t で打ち切った値を渡さない。
  - `thickness_mm`：突縁の平均厚さ t（0 より大きく H より小さい）。変厚のスラブは照査断面での平均厚さを渡す。
  - ウェブは部材の B×H（H はせん断用ハンチを含む）。分割は「ウェブの全高＋両側の突縁」と「突縁の全幅＋ウェブの突縁より下」のねじり剛性が大きいほうを Capacita が採る。
  - 曲げの T 形（`shape: 2`、`Bt`・`t`）とは独立。矩形（`shape: 1`）の部材にも書ける。円形・小判に書くと ID 205、欄の欠け・範囲外は ID 206（どちらもエラーで部材要素を作らない）。
- 確かめた例：設計計算例 ＲＣラーメン高架橋（場所打ち杭）II-273〜277 の電車線柱受け梁（B 850・H 840、t 344、上限 1785、f'ck 27、γc 1.3・γbt 1.3）で、Kt 188943.6×10³ mm³（見本 1.889×10⁸）、Mtcd 231.4（見本 231.4）、γi·Mtd/Mtcd 0.895（見本 0.90）。`torsion_flange` を外すと Kt 122931.3×10³、Mtcd 150.6。

## 自分で解いた骨組の断面力を PIK にして渡す（2026-10-27、Capacita の本物の runner で確認）

案件で骨組を FEMPython 以外で解いたとき（例：円形立坑のリング梁）も、断面力を PIK の書式で書いて `--pickup` で渡すと、Capacita が Mmax・Mmin・Nmax・Nmin の行から照査用の断面力を選ぶ。断面力入力モード（`force[]`）で自分で行を選ぶより、原本（旧 WebDan の計算書）に合った。

- 書式は固定幅（`PickupImporter.ParsePik`）。先頭行は読み飛ばす。1 行は、PickUpNo・種別（`M`・`S`・`N`）・部材・最大側の組合せ・最小側の組合せ・着目点名・位置（各 5・5・5・5・5・5・10 桁）、続けて最大側の Md・Vd・Fx、最小側の Md・Vd・Fx（各 10 桁）。Fx は圧縮が負（Capacita が符号を反転して軸力 Nd にする）。M の行は Md の最大・最小、S は Vd、N は Fx の最大・最小を取った組合せ。
- WDJ の `schema_version` は `"1.0.0"` の形（数値の 1 だと `pickup_import_failed`）。`basic.pickup_moment`・`pickup_shear_force` の `no` に PIK の PickUpNo を入れる。
- 着目点の引張側（外側・内側）は、行の Md の符号で Capacita が決める（正が下側＝`rebar2`）。`rebar1`・`rebar2` の題を面の呼び名にそろえる。正負の両方が現れる部材は 2 列になる。
- `bar[].rebar_lines` は**1 段当たりの本数**、`rebar_space` が**段間隔**、`rebar_n` が総本数（段数＝`rebar_n/rebar_lines`）。有効高さは `rebar_cover`（1 段目の芯かぶり）＋重心までの段の距離（例：lines 5・n 10・space 190・cover 126 で d=221、n(段)=2）。段数を `rebar_lines` に書くと d と ひび割れ幅が狂う。
- `safety_factor` の `range` は、耐久性の曲げ（縁圧縮応力度）で 1（引張鉄筋だけ）にすると圧縮鉄筋を数えず σc が大きく出る。原本が圧縮鉄筋を「－」と印字しているときは 1。
- R5 の `crack[].k4` は水掛かりの程度に応じた値を WDJ に書く（常時湿潤 0.7）。0.85 を書くと 0.7 より照査値が約 2 割大きく出る（原本は 0.7）。

### FEMPython の PIK を渡すとき（2026-10-27、円形立坑のリング梁 62 点で確認）

- FEMPython の `pickup.pik` は各部材の ITAN と JTAN を出す。WDJ の着目点と一致させるため、照査したい着目点（例：ITAN だけ）の行に絞ってから渡す。
- M の符号は、閉合骨組を時計回りに i→j と並べると外側引張が正（局所 y が外向き）。Capacita は正の Md が下側引張。原本が外側引張を負と印字しているなら、PIK の Md の符号を反転する。**M の行は反転で最大と最小が入れ替わる**ので、最大側と最小側（組合せ番号と Md・Vd・Fx）も入れ替える。S・N の行は Md の符号だけ反転する。
- PIK だけで `calc.print_section_force_checked: true`（断面力一覧表）と `print_safety_ratio_checked: true`（検討結果一覧表）を立てると、`reportSections` に `section_forces`（62 点で 16 頁）と `safety_ratios`（7 頁）が加わる。曲げ・せん断の節の頁数は 13・26 頁ずつ（62 点）。
- 原本が 1 m 幅で照査しているときは、骨組の断面力も 1 m 幅に換算してから渡す（FEMPython の入力の断面・ばね・荷重を同じ比で縮める）。

### 矩形の開削ボックスの PIK を渡したとき（2026-10-30、1層1径間・4 部材、本物の runner で確認）

- 上の「時計回りで外側引張が正」は、文書の座標（y 下向き）にそのまま時計回りに書いた場合（画面では反時計回りに見える）。文書の y を負にして書き（画面が y 上向きの図と同じ向きになる）、図で見て時計回り（上床版 左→右、右側壁 上→下、下床版 右→左、左側壁 下→上）に並べると、全部材の M が**内側引張で正**になり、外側の主鉄筋を `rebar1`（上側）、内側を `rebar2` にすれば反転せずに取り込めた。判定は FEMPython の headless-runner スキルの規則（文書の座標で局所 x を +90° 回した向きが局所 y、その側の引張が正）。
- 部材グループで照査の行に割り当てる PICKUP が違うとき（例：床版は No.2・4・5、側壁は No.3・6・7 の組合せ）は WDJ を分け、PIK をその部材の行（3 列目の部材No）だけに絞って渡す。取込みの番号は絞った PIK の並びで付き、そのまま計算できた。
- `specification2_list` の id 0 `H16_Rail` が JR各社（README の並び H16_Rail・H16_Shinkansen・H16_JREast が JR各社・運輸機構・JR東日本）。H16 の行7（復旧性（損傷）地震時）の曲げは γi·Md/Myd（降伏耐力）で、損傷レベル1 の照査として使える。せん断は γi·Vd/Vyd と γi·Vd/Vwcd。
- せん断補強鉄筋の無い版（t=500、Vd≈280 kN）は安全性（破壊）のせん断が NG（Vcd だけ、γi·Vd/Vyd＝1.49）。スターラップ D13@250（奥行 1m に 4 本）を入れると耐久性（せん断ひび割れ）のスターラップの応力度 σwpd/σsl2（σsl2＝120）が 1.01〜1.37 で NG、D16@250 で OK。`shear[]` を空にすると Vdd（せん断スパン）は計算しない。

## 骨組の一部の点だけを --pickup で照査する WDJ（2026-10-31、コードを読んで確認、Capacita 37174da。本物の runner では未確認）

鉄道ラーメン高架橋の直角方向の骨組（WebRamen R1h）を調べたときのもの。根拠は `WebDanforCS/Application/Imports/PickupImporter.cs` と `RcDan/OrganizedInputData/MemberGroup.cs`・`FocusPoint.cs`・`OrganizedInput.cs`、`RcDan/Verification/VerificationControl.cs`、`RcDan/CalcResult/*` など。

- **WDJ に書かなかった PIK の点**は取込みで足されるが、`isMzCalc`・`isVyCalc` が false なので照査されない（メッセージも出ない）。WDJ に無い部材は `g_id` が空で、どのグループにも入らない。照査したい点だけを、PIK の並びの番号（最小の PickUpNo の1成分の行の順、1 から）を `index` にして書けばよい。
- **受け継ぎ**：足された点は、同じグループで index が一つ前の点の配筋（表モード）・ひび割れの条件（環境・ε'csd・k4・kr）・疲労の係数を受け継ぐ。外観の `vis_u`・`vis_l` だけは受け継がず false。
- **点・面の選択**：`points[].isMzCalc`（曲げ）・`isVyCalc`（せん断）。`isUpperCalc`・`isLowerCalc` は上側引張・下側引張の可否で、その点の**すべての照査**に効く（曲げだけ下側、せん断は両側、のようには分けられない）。外観は `crack[].vis_u`・`vis_l`。
- **pickup の行は WDJ に1組で全グループ共通**。グループごとに照査を切るのは `safety_factor` の行の `NoCalc: true`（計算の種類ごと。曲げとせん断を分けて切れない）か、`calc.member_group_selection` の `Checked: false`（そのグループの照査を全部しない）。照査ごとに点や面を変えたいときは WDJ を分ける。`no` が null の行は黙って飛ばされる（せん断の行 6 を空にすれば復旧性のせん断は出ない）。
- **H16 の pickup の id**：曲げ 0 耐久性（縁応力度、永久＋変動）・1 耐久性 永久・3 疲労 永久・4 疲労 永久＋変動・5 破壊・6 復旧性 地震時以外・7 地震時・8 最小鉄筋量（id 2 は H16 に無く、書くと info の WD-5 で無視）。せん断 0 耐久性 ひび割れ判定（Vhd）・1 耐久性 永久・2 耐久性 変動・3〜7 は曲げと同じ。各行の PIK の最大側・最小側の両方が候補で、引張側はその状態の Md の符号で決まる。
- **疲労**：曲げは行3×行4 の候補の組を全部計算し、σmin＝行3、σmax＝行4（逆なら入れ替え）、印字の Mrd は行4 − 行3。せん断は |Vd| の小さいほうで Vcd と Vpd、Vrd＝大きいほう − Vpd（符号付き）。行4 が無い側は照査しない。同じ PickUpNo（例：永久と永久＋列車の2つの組合せの最大・最小）を行3・行4 の両方に当てると、Mrd＝最大側 − 最小側、永久＝最小側になる（推定）。
- **疲労の係数** `fatigues.fatigue_list[]`：`M1`・`V1` が上側引張、`M2`・`V2` が下側引張。`SA`・`SB`（SA/SC・SB/SC）、`NA06`・`NB06`・`NA12`・`NB12`、`A`（荷重分担比 a）、`B`（複線の同時載荷の確率 b、既定 0）、`r1_1`（軸方向鉄筋、既定 1.0）・`r1_2`（せん断補強鉄筋、既定 0.65）・`r1_3`（折曲げ）。`Class`・`weld` は鋼材用で使わない。r2＝{1/((a^(1/k)＋(1−a)^(1/k))(1−b)＋b)}^k を Capacita が計算する。`train_A_count`・`train_B_count` の既定は 0 で、書かないと ΣN＝0 で疲労が常に「省略」になる（`service_life` の既定 100）。
- **変断面のせん断** `bar[].tan`（tanβ＋tanγ）：Vd'＝sign(Vd)·max(|Vd|−|Md|·1000·tan/d, 0)（d は mm）。正なら |Vd| が減る。H16 だけ（R5 では 0）で、耐久性・疲労・破壊・復旧性のせん断に効き、a/d＜2 の Vdd には効かない。`haunch_M`・`haunch_V` は曲げ用・せん断用に部材の H に足す高さ（mm）。
- **鉄筋**：表モード（`input_mode` 0）の `rebar1/2.cos` は鉄筋の傾きの補正（本数×cos を断面積、かぶり/cos を位置に）。`rebar_n` は小数を書ける。側方鉄筋は `sidebar1` の `side_n`（片側の本数）・`side_cover`（最上段の芯かぶり）・`side_ss`（上下の間隔）で等間隔だけ。間隔の違う段や段ごとに本数の違う側方鉄筋は、プレビューモード（`input_mode` 1、`rebar0[]` に `rebar_type`（0 上側・1 下側・4 側方…）・`dia`・`quantity`・`dist_top`・`dist_side`・`interval` の行を並べる）で書く。プレビューモードは `cos`（斜率）と折曲げ鉄筋を使えない。
- **T 形**：`members[].shape` 2。`B` ウェブ幅、`H` 全高、`Bt` フランジ幅（有効幅としてそのまま使う）、`t` フランジ厚。フランジは上側で、上側引張は矩形 B×H として計算する。せん断はウェブの矩形。`bar[].b`・`h` は表示用。
- **ディープビーム**：H16 では a/d＜2 のとき破壊・復旧性（地震時以外）で Vdd を自動で計算する。`deep_beam` は書かない（H16 で書くと WD-411 のエラーでその点が作られない）。
- **H16 で使う安全係数の行**は id 0（耐久性・外観で共用）・2（疲労）・5・6・7・8（8 の値は無視）。`V_rbs` は疲労のせん断では frd の γb。疲労のせん断の γc・γs は `M_rc`・`M_rs`。
- **疲労で永久作用に正負の対があるとき（2026-10-31、本物の runner で確認、WebRamen R1h-c）**：行3・行4 に当てた pickup が正負の対（例：電車線柱の無風時の荷重 ±）を含む組合せの最大・最小だと、Capacita は行3 と行4 の候補を全部の組で計算するので、永久作用の向きの違う組（実際には起きない）が混ざり、Vrd・Mrd を大きく見積もる（例：Vrd 229.9、正しくは 190.8）。骨組の側で、対の片方の向きだけの組合せと pickup を作り（FEMPython の define に符号つきのケースを1つだけ書くと通る）、向きごとに WDJ を分けて照査する。
