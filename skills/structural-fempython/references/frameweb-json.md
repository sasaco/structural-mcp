# FrameWeb の入力（FrameWebforCS の保存 JSON、2D）

FEMPython eb6d4af、2026-10-30。出どころは各項に書く。「コードで確認」は `FEMPython/FrameWebforCS/calculation/CalculationRequest.cs`・`FEMPython/FrameWeb/src/` を読んだもの（実行していない）。書き方の例は WebPier（`WebPier/webpier/export/frameweb/build.py`・`cases.py`）と WebRamen（`WebRamen/webramen/export/frameweb.py`・`frameweb_design.py`・`slab_beams.py`）で、どちらも本物の runner で解いている。

## 全体

```json
{
  "dimension": 2,
  "node":    { "1": { "x": 0, "y": 0, "z": null } },
  "member":  { "1": { "ni": "1", "nj": "2", "e": "1", "cg": null } },
  "element": { "1": { "1": { "E": 28000000, "G": null, "Xp": 1e-5, "A": 0.6, "J": null, "Iy": null, "Iz": 0.045, "n": "柱" } } },
  "rigid":   [ { "m": "3", "e": "9", "Ilength": 0.3, "Jlength": 0 } ],
  "fix_node":   { "1": [ ... ], "2": [ ... ] },
  "fix_member": { "1": [ ... ], "2": [ ... ] },
  "load":    { "1": { "fix_node": 1, "fix_member": 1, "element": 1, "symbol": "D1", "LL_pitch": 0.1, "rate": 1, "name": "死荷重", "load_node": [ ... ], "load_member": [ ... ] } },
  "define":  { "1": { "row": 1, "C1": 1, "C2": -1 } },
  "combine": { "1": { "row": 1, "name": "安全性（1）", "C1": 1.1, "C2": 1.0 } },
  "pickup":  { "1": { "row": 1, "name": "安全性（破壊）", "C1": 1, "C2": 2 } }
}
```

- 単位は m・kN。E は kN/m²（kN/mm² の値×1,000,000）。変位は m、回転は rad（WebPier・WebRamen、本物で確認）。
- y は下向きが正（SKILL.md の「符号と座標」）。整数の値は整数で書いてよい（WebPier は Example2 にならい整数で書く）。
- `ver` を書かないと、FrameWebforJS（ブラウザ版）で開いたときに上下逆に見える。FEMPython の計算と印刷には影響しない（WebPier ADR-0005）。

## node・member・element

- `member` の `e` は `element` の断面の番号。`element` の一段目の `"1"` は断面の組の番号で、荷重ケースの `element` で選ぶ。
- 各断面に `Xp`（線膨張係数）を書く。温度荷重（マーク 9）のひずみは P1×`Xp`（コードで確認：`FrameWeb/src/fem/model.py` の `temperature_strain`）。温度荷重を使わない骨組でも、WebPier・WebRamen は Example2 にならい 1e-5 を書いている。
- 部材荷重の位置を決めるとき、部材長と距離は mm に丸めて扱う（`CalculationRequest.cs` の `JsRound(... * 1000)`、コードで確認）。

## rigid（剛域）

- 行は `{ "m": 部材, "e": 剛域に使う断面, "Ilength": i 端からの剛域長, "Jlength": j 端からの剛域長 }`。FrameWeb はその点で部材を分け、剛域の部分に `e` の断面を使う（WebRamen R1d、本物で確認）。
- 剛な断面は有限の剛性にする例：WebPier・WebRamen は A＝Iz＝1000、E は柱の材料の値（WebPier の Example2 の剛なフーチングと同じ扱い）。
- 部材全体が剛域に入るときは、その部材の `e` を剛な断面にする（WebRamen R1g-b）。

## fix_node（節点の支点・ばね）

- `fix_node` は組の番号ごとの行の配列。行は `{ "row", "n": 節点, "tx", "ty", "tz", "rx", "ry", "rz" }`。
- 値の意味：**0 か null は自由、1 は拘束、それ以外はばね値**（kN/m、kN·m/rad。絶対値を使う）（コードで確認：`FEMPython/FrameWeb/src/fem/file_io.py` の fix_node の読込み）。**ちょうど 1 のばねは書けない**（拘束になる）。値に辞書を書くと非線形の支点になる（JRSNAP 互換の多直線ばね。静的な線形の骨組では使わない）。
- 例：WebRamen は杭先端の鉛直・水平・回転ばねを書き、0 のばね（SOIL-JR が出さないもの）は null にして自由にする。

## fix_member（部材の分布ばね）

- 行は `{ "row", "m": 部材, "tx": 部材軸方向, "ty": 部材軸直角方向, "tz", "tr", "length"? }`（値は絶対値）。杭なら tx が周面の鉛直せん断ばね、ty が水平ばね（WebPier・WebRamen）。
- `length`（m）：同じ部材の行が全部 `length` なしなら、どの行も部材全体に効く（足し合わせ）。`length` を書くと、i 端から順に区間を並べたことになり、空にしてよいのは最後の行だけ（部材の残り全部）。区間の和が部材長を超えると失敗（コードで確認：`FrameWeb/src/fem/legacy_beam.py`）。
- 例：WebPier は杭の部材1本に、杭頭からの区間ごとの行（`length` つき）を書く。WebRamen は地層の境に節点を置いて杭を部材に分け、部材ごとに `length` なしの行を書く。
- `fix_member` のばねの反力は `support_reactions` に入らない（SKILL.md、本物で確認）。

## ばねの組を荷重ケースごとに選ぶ

- `fix_node`・`fix_member` を組の番号（`"1"`・`"2"`…）ごとに持ち、荷重ケースの `fix_node`・`fix_member` でどの組で解くかを選ぶ。FEMPython は荷重ケースごとにその組で解き、応答を線形に組み合わせる。
- 例：WebPier・WebRamen は "1" を長期（永久作用：死荷重・収縮・温度など）、"2" を短期（変動作用：列車・風など）のばねにしている。

## load（荷重ケース）

- キー：`fix_node`・`fix_member`（ばねの組）、`element`（断面の組）、`symbol`、`LL_pitch`、`rate`、`name`（FEMPython が頁に印刷する名前）、`load_node`、`load_member`。WebPier・WebRamen は `LL_pitch` 0.1・`rate` 1（FrameWebforCS が保存する値。静的なケースでは使われない）。
- **`symbol` がちょうど `"LL"` の荷重ケースは移動荷重**として、`LL_pitch` の刻みで荷重を動かした子のケース（`<番号>.<n>`）を作る（コードで確認：`CalculationRequest.cs`・`CalculationDerivedPresenter.cs`）。位置の決まった列車荷重などを `"LL"` と名付けない。
- `load_node` の行：`{ "row", "n", "tx", "ty", "tz", "rx", "ry", "rz" }`。0 の成分は null でよい。
- 荷重の行が実質ないケースは計算から外される（SKILL.md の「中身のない荷重ケース」）。部材荷重は、L1・L2・P1・P2 が全部 null の行、分布荷重で P1・P2 がどちらも 0 の行を読まない（コードで確認）。

## load_member（部材荷重）の細部

行は `{ "row", "m1", "m2", "direction", "mark", "L1", "L2", "P1", "P2" }`。マークの表は SKILL.md。

- **方向** `direction`：`x`・`y`・`z` は部材座標、`gx`・`gy`・`gz` は全体座標（コードで確認：`legacy_beam.py`）。WebPier・WebRamen の分布荷重は `gy`（鉛直）・`gx`（水平）。マーク 9 は方向を使わない（WebRamen は `"x"` を書いている）。マーク 11 のモーメントは方向の軸まわりに働くので、2D の面内のモーメントは z 軸まわり（`gz`）になる（コードで確認、未実行。WebRamen は梁の上のモーメントを節点荷重の rz で書いている）。
- **マーク 1・11 の位置**：L1・L2 はどちらも i 端からの距離。i 端（0）や j 端（部材長）に置いた荷重も効く（eb6d4af から）。距離は mm の細かさで扱い、mm で部材長と同じ距離は j 端（`FEMPython/GLOSSARY.md`）。
- **マーク 2 の位置**：L1 は i 端から荷重の始まりまで、L2 は荷重の終わりから j 端までの残り。部材全体なら L1＝L2＝0。WebPier は L2 を「部材長−荷重の終わり」を十進で引いて書き、斜めの部材（長さが印字した数でない）の部分荷重は書かない。
- **m1〜m2 の範囲**：m1 から m2 までの連続した部材に1行で載せると、L1 は最初の部材の始端から、L2 は最後の部材の終端からの距離で、P1→P2 は載荷の区間全体で線形に変わる（`CalculationRequest.cs` の `MemberGroupRows`、コードで確認）。部材ごとに値を求めて1部材1行で書けば、この規則に頼らずに済む（WebRamen は区間ごとの両端の値を十進で補間して書く）。
- **負の L1・L2**：FrameWebforJS の入力の互換として、負の値を前の行の続き（相対の距離）として読む規則がある（`NormalizeRelativeMemberRows`、コードで確認）。スクリプトからは 0 以上の距離を書く。
- 部材荷重の区間の端には FEMPython が節点を足す。PIK の着目点の途中点も増える（SKILL.md の「PIK を Capacita に渡す」）。

## define・combine・pickup

- `define`：`{ "<番号>": { "row", "C1": 荷重ケース, "C2": ... } }`。値は荷重ケースの番号で、**負の番号は符号を反転した荷重ケース**。1つの DEFINE に複数の荷重ケースを並べると、その中から抽出する（WebPier：0620 の上り線と下り線のような選択肢、と符号の両方）。
- `combine`：`{ "<番号>": { "row", "name", "C<DEFINE の番号>": 係数 } }`。WebPier は 0.00 と印字される係数（0.005 未満）の項を書かない。
- `pickup`：`{ "<番号>": { "row", "name", "C1": COMBINE の番号, ... } }`。照査ごとに1つ（WebRamen は表5.3.4 の照査ごと、WebPier は抽出の群ごと）。
- DEFINE が1つもないときは、COMBINE の `C<n>` を荷重ケースの番号として読む（`CalculationDerivedPresenter.cs`、コードで確認）。
- 組合せの係数は印字した値をそのまま書く。FEMPython は丸めずに掛けるので、作用ごとに丸めた計算書の合計とは丸めの分（WebPier では作用1つあたり最大 0.005）だけ違う。
