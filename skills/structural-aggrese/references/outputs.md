# runner の成果物（report.pdf・pickup.pik・summary.xlsx）

Batch 5.3.0.1。確認は 2026-10-19（直接基礎の橋脚の線路方向 1 Case・線路直角方向 2 Case の XML と JRSNAP の結果で、実アプリ）。ソースは開発機のみ（structural-mcp の repo のルートから `Batch/Aggre-SE/`）。

## 引数で成果物が決まる

- runner の成果物は引数で決まる：`--report-pdf false --pik true` なら `result.json` と `pickup.pik` だけ、`--summary-xlsx false --report-pdf true --pik false` なら `result.json` と `report.pdf` だけ（実アプリで確認）。
- `summary.outputs` に作ったものの名前が並ぶ（result.json は含まない）。呼び出し側は、envelope の成果物の組（kind と relativePath）が求めたものと一致するかを確かめるとよい。
- `--check-tables true`（`--report-pdf true` が必要）はケースごとの照査表 `cases/case-NN.xlsx` と荷重変位 `cases/case-NN.csv`（Shift-JIS）も作る（コマンドライン版の cmd=1 と同じ。Headless の README.md）。

| 引数 | 成果物 | kind・media type |
|---|---|---|
| `--summary-xlsx true` | `summary.xlsx` | `summary-xlsx`、xlsx の media type |
| `--report-pdf true` | `report.pdf` | `report-pdf`、`application/pdf` |
| `--pik true` | `pickup.pik` | `pickup-pik`、`text/plain; charset=shift_jis` |
| `--pile-anchor-bar-pdf true` | `pile-anchor-bar.pdf`（杭の段落し図） | `pile-anchor-bar-pdf`、`application/pdf` |
| 常に | `result.json`（先頭） | `result-json`、`application/json` |
| `--foundation-steps true` | `foundation-steps.csv`（直接基礎のときだけ） | `foundation-steps-csv`、`references/foundation-steps.md` |

## 計算書 report.pdf

- 構成（実アプリで確認）：Case ごとに7ページ（荷重～変位曲線と水平震度の表、非線形応答スペクトル法の算定、変位図、M・S・N 図、損傷状況図）、続けて応答値一覧表、設計総括表（A3 横）、安全率一覧表、直接基礎の照査（A3 横）。1 Case で11ページ、2 Case で18ページだった。2026-10-22 に、Case ごとに照査項目（`dgCaseList`）が違う4 Case・8 Case の XML（project-xml.md の例）でも、32ページ・60ページ（7×Case 数＋4）で、照査項目の違いでページ数は変わらなかった。
- **頁数は一定ではない（2026-10-28、WebRamen R10f。本物の Batch で柱列のラーメン2 Case が 20頁、`reports/PDFReport.vb` の `Create荷重変位曲線と応力図`・`Create荷重変位曲線` で確認）。** 上の「7頁」は、状態の行が少ない Case と断面の少ない骨組のときの数。Case ごとの頁は、①荷重～変位曲線（状態の行が13を超えると、同じ頁に「水平震度と水平変位(概要)」を付けて改頁）、②「水平震度と水平変位」の表（`printMaxRow` 行ごとに1頁、行の数で頁が増える）、③非線形応答スペクトル法による設計応答値の算定（変位増分解析 `KaisekiFlg = 1` のときだけ）、④変位図・モーメント図・せん断力図・軸方向力図・損傷状況図（5頁）。続く総括の頁も、設計総括表（A3 横）が断面の数で2頁以上になる（15断面で2頁）。Case ごとに別の PDF（`BatchPrintP-δ<n>.pdf`）を作ってから1つにつなぐので、頁の範囲は Batch の中では分かるが、runner はいま返さない。頁を抜き出す呼び出し側は、頁数を決め打ちしない。→ **runner が `summary.reportSections`（result.json にも）で節ごとの頁の範囲を返すようにした（Batch の develop、2026-10-28、未 commit の時点で確認。WebRamen の Q32）**：先頭頁の順に `{id, caseNumber, firstPage, lastPage}`（1 始まり・両端を含む。`summary` の節には caseNumber がない）。id は Case ごとに `load-displacement`（曲線と水平震度・水平変位の表）・`response`（応答値の算定。変位増分解析のときだけ）・`figures`・`check-table`（照査表を作ったときだけ）、最後に `summary`。頁のない節は出ない。`--report-pdf true` のときだけ出る。契約は Batch の `Aggre-SE/Headless/README.md`。
- 「水平震度と水平変位」の表の列は「増分ステップ・Kh・δ(mm)・状態」だけで、**回転角の列はない**。並ぶのは状態が変わったステップ（部材が損傷レベルに達した等）だけで、**全ステップではない**（2026-10-28、本物で確認）。
- 照査項目を ①② だけにし、基礎の照査位置を持たせない（`dgReactAtPoint` が空、`dgDispAtPoints` の節点なし、`--sdr` なし）杭基礎のプロジェクトも、runner はそのまま走り `SDR_REQUIRED` にならない。総括表の KhL1 は `-----`。Teq は `Math.Round(2 * Math.Sqrt((δeq[mm] / 1000) / Kheq), 3)` を丸める前の値から求めるので、印字の Kheq・δeq から 2.0√(δeq/Kheq) を計算すると丸めの範囲で一致する（`CalculationCase.vb:483`。本物で 0.5590→0.559、0.5420→0.542。2026-10-28）。空の `dgReactAtPoint` は、Aggre-SE 自身の保存し直し（`scripts/aggrese_project_roundtrip.cs`）で `<dgReactAtPoint />` と書かれる。
- 1ページ目の見出しは DB1 の `KihonInfo.Title`（NDU の題名）と `Comment`（空なら DB1 の名前）で、`reports/PDFReport.vb` の `Create荷重変位曲線`（コードで確認）。利用者が書き込んだ見出しは再現できない。
- 応答値は Case の2ページ目（非線形応答スペクトル法の算定）の文字として取り出せる：`Ｋheq = …`・`δeq  = … mm`・`μ = …`・`δr = μ・δeq = … = … mm`・`Khr = …`（1 Case 目で確認）。
- 帳票は毎回同じバイトにならない（同じ入力で SHA が変わった。実アプリ）。新旧の判断にファイルの SHA を使わない。
- 地盤反力分布図や「直接基礎底面回転ばねの算定値」のリストは JRSNAP の基礎照査の出力で、Aggre-SE の計算書には入らない。
- 破壊形態が「せん断」の部材（NDU の `NonLinInfo` の第4欄 2、NDT の AP カードの `S`）は、損傷レベルの制限値を降伏にそろえる（`reports/CalculationElement.vb:963-969`、コードで確認）。WebPier の P7橋脚の直角方向（2026-10-20、実アプリ）で、制限値の部材角は θ＝0.001143（同じ柱の曲げ型の線路方向は 0.015714）だった。これは La/d 1.7 の柱に `S` を付けた WebPier の決定66 による。低せん断スパン部材は La/d＜1.25 で、1.25≦La/d＜2 に `S` を付けるのは誤り（利用者 2026-10-28。WebPier は決定114 で柱に `S` を付けなくした）。
- 設計総括表と安全率一覧表で、L1 地震動の判定が食い違うことがある：WebPier の P7橋脚の線路方向（2026-10-20、実アプリ）で Kh/Khy＝1.018 が、設計総括表では損傷レベル NG、安全率一覧表では OK と出た。どちらが正しいか・原因は調べていない。判定を読むときは両方の表を見る。
- 版による違い（推定：古い版の Aggre-SE で作られた計算書と比べた）：古い版は直接基礎の照査の見出しが「1.復旧性（性能レベル1）…3.安全性」、いまの Batch は「1.安定レベル1…3.安定レベル3」。安全率一覧表は古い版の計算書になく、いまの Batch は出す。

## ピックアップ pickup.pik

- 書式は FEMPython の PIK と同じ行で、先頭行 `Batch ver1.0.0`、Shift-JIS・CRLF。
- ピックアップは `reports/ExcelReportPickUpFile.vb` の `GetPickUpFile`。`Option_PickUpFileCase = 0`（既定）なら3つ：1＝L1地震動（`復旧性_L1震度step`）、2＝復旧性L2（`復旧性_最大応答step`）、3＝安全性L2（`安全性_最大応答step`）。どれも照査対象 ⑨断面力ピックアップ（`_解析対象(8)`）の全 Case について、ステップ 0〜そのステップの各部材の両端の M・S・N の最大・最小。`Option_PickUpFileCase > 0` だと普通地盤・液状化・応答変位法に分けた10個になる（コードで確認）。
- ピックアップの番号（1〜3）は抽出ケースの番号とは対応しない。
- 同じ入力で同じバイト（実アプリで確認）。大きさの例：部材6本で109行・11 KB、部材7本で127行・13 KB。
- 部材の番号は JRSNAP の骨組（NDU の MemberInfo）のもので、着目点は各部材の ITAN・JTAN だけ（途中点はない）。FrameWeb など別の骨組の部材番号とは合わない。

## 総括表 summary.xlsx

- 約27 KB。シートは応答値一覧表・設計総括表・安全率一覧表・直接基礎の4枚（計算書の最後の4ページと同じ）。
- 総括表を標準スタイル（XML の `Calculation/_rbProduct` が true,false、runner の `summary.productStyle` 0）にした杭基礎のラーメン（Batch の見本「T形両端固定」）では、応答値一覧表・M-θ・M-φ・安全率一覧表の4枚だった（2026-10-22、Batch eb74d80）。
- 損傷レベルの θd・φd と制限値 θ1〜3・φ1〜3 は、JRSNAP の総括表（5.2-L03・5.3-L01体験版2）が小数点以下7桁。Batch の `ExcelReport.vb` は 2026-10-23 まで `Math.Round(値, 7)` のあと `"0.000000"` で6桁表示だった。書式を `"0.0000000"` にした runner の `summary.xlsx` は、V53 の PHC で JRSNAP の `…_安全性.xlsx` と7桁まで全項目一致した（軸力も同じ。実アプリ）。比べ方と JRSNAP 側の総括表は スキル structural-jrsnap-input（耐震設計総括表の節）。決定ケースの記録（`CalculationElement.vb` の `Math.Round(Math.Abs(φr), 6)`）は6桁のままで、この見本では差が出ていない。

## 両端固定 M-θ 部材の Vmu・Vud（JRSNAP 5.2-L03 のチェック）

JRSNAP の解析条件「破壊形態の判定において、両端固定支持された M-θ 部材の Vmu と Vud の値を計算して照査する」（.ndu の項目はスキル `structural-jrsnap-ndu`）を入れて解析した DB1。同じモデルをチェックなし・ありで解析して比べた（2026-10-22、JRSNAP 5.2-L03、SNAPDBLib は Batch cb652a3 のもの）。

- SNAPDBLib：`InputInfo.KihonInfo.Both_VmuVud` がチェック（0／1）。対象の部材は、連番の非線形番号（① I 端・② J 端）で同じ断面（`DLInfo.SIJI = 2`）の組。
- `OutputInfo.OutSoukatu[n].Break`：`La` が **−999.999**（定義書の「−999」ではない）。`Vmu = |Mm1 − Mm2| / (DLInfo.L2 / 1000)`（`L2` は部材長で単位は mm。`Mm` は符号付き）で、`Vmu`・`Vyd`（=Vud、JRSNAP の min(Vud+, Vud-)）・`Vmu_Vyd` が両端で同じ。I 端の `Mm` も変わる（例：−4795.1 → 2870.3）。
- チェックで I 端の `Sendan`（せん断破壊の照査）も変わった（StepNo1・2 が 0,0 → 119,346、Vdmax 115.9 → 1344.5 kN）。定義書の説明にない変化で、意図どおりかは SNAPDBLib の開発者に確認中。ほかの非線形番号の `Break`・`Sendan`・`Sonsho` は全項目が同じ。
- Aggre-SE（Batch eb74d80 以降）：M-θ で La ≦ −999 の部材を両端固定（`cls破壊形態の照査.is両端固定`）とし、総括表の M-θ シートと計算書の La を `-----` と出す。Vmu・Vud・Vmu/Vud は DB1 の値のまま。カスタムせん断耐力の設定があっても、この部材の Vud は算定し直さない。それより前の Batch では La が `-999.999` と出る。
- 確かめるテスト（開発機のみ。structural-mcp の repo のルートから）：`Batch/tests/Aggre-SE.Test/BothEndsFixedVmuVudTests.cs`。見本は `Batch/tests/JRSNAP_Ver5.2-L03/08_両端固定のVmu・Vud(V52-L03)/`。
- zip の中の日時は 1980-01-01 で固定だが、`xl/workbook.xml` の `documentId`、各シート・図の `xr:uid`・`a16:creationId` の GUID と `docProps/core.xml` の `dcterms:modified` が毎回変わるので、同じ入力でもバイトが変わる（2026-10-19、2回作って比べた）。検査するならシート名の並びを見る。

## RC 部材の設計せん断耐力 Vud（JRSNAP の pw·fwyd/f'cd ≦ 0.1）

計算書の「破壊形態」「せん断」の Vud は、JRSNAP が DB1 に書いた値（`Sendan.Vyd`、a/d＞2 は Vyd と Vwcd の小さいほう、a/d＜2 は Vdd。操作説明書 付録3 付3-3）で、Aggre-SE は算定し直さない。

- JRSNAP（5.2-L03）は RC 部材の Vyd のせん断補強鉄筋の項を、**pw·fwyd/f'cd ≦ 0.1 で頭打ち**にする（付録の警告 34「pw・fwyd/f'cd>0.1 のため、Vyd または Vasud において、pw・fwyd/f'cd=0.1 で計算しています」）。選べるのは、この式の f'cd に使う γc を入力値（1.3）にするか 1.0 にするかだけ（解析条件「せん断耐力算定時（鉄筋コンクリート部材）の pw・fwyd/f'cd≦0.1 の照査式に適用するγc」、NDT の DataInfo の H、51カラム目：0 入力値、1 γc=1.0。警告 35）。
- 例（WebRamen の RC ラーメン高架橋の中間部の上層梁、2026-10-27、本物の JRSNAP・Aggre-SE）：bw 750・d 977・D16 4本 @100（pw 1.059 %、pw·fwyd/f'cd＝0.176）で、Vud 1577.5 kN＝Vcd 374.6＋0.1×20.77×750×(977/1.15)/1.1。頭打ちしない手計算（見本の設計計算例 III-210 の 2488.8）より 37 % 小さく、せん断耐力の照査が NG（1.074）になった。γc=1.0 なら 1938.7。
- 帯鉄筋が少ない部材（同じ例の柱 D19 2本 @125、0.090）は頭打ちにならず、手計算と合う。
- **場所打ち杭の円形断面でも同じ上限が掛かる**（2026-10-30、JRSNAP 5.2-L03 の本物の解析、WebRamen R6 の杭頭）：D22−2 @125、f'cd＝21/1.3 で、Vyd 1078.6 kN＝βVcd 226.7＋0.1·f'cd·bw·z/γb 851.9 と再現できた（頭打ちしなければ Vsd 1271.9・Vyd 約 1498.6）。γc を 1.3（入力値）か 1.0 にするかは選べるが、上限そのものは外せない。
