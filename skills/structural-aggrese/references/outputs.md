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

- 構成（実アプリで確認）：Case ごとに7ページ（荷重～変位曲線と水平震度の表、非線形応答スペクトル法の算定、変位図、M・S・N 図、損傷状況図）、続けて応答値一覧表、設計総括表（A3 横）、安全率一覧表、直接基礎の照査（A3 横）。1 Case で11ページ、2 Case で18ページだった。
- 1ページ目の見出しは DB1 の `KihonInfo.Title`（NDU の題名）と `Comment`（空なら DB1 の名前）で、`reports/PDFReport.vb` の `Create荷重変位曲線`（コードで確認）。利用者が書き込んだ見出しは再現できない。
- 応答値は Case の2ページ目（非線形応答スペクトル法の算定）の文字として取り出せる：`Ｋheq = …`・`δeq  = … mm`・`μ = …`・`δr = μ・δeq = … = … mm`・`Khr = …`（1 Case 目で確認）。
- 帳票は毎回同じバイトにならない（同じ入力で SHA が変わった。実アプリ）。新旧の判断にファイルの SHA を使わない。
- 地盤反力分布図や「直接基礎底面回転ばねの算定値」のリストは JRSNAP の基礎照査の出力で、Aggre-SE の計算書には入らない。
- 版による違い（推定：古い版の Aggre-SE で作られた計算書と比べた）：古い版は直接基礎の照査の見出しが「1.復旧性（性能レベル1）…3.安全性」、いまの Batch は「1.安定レベル1…3.安定レベル3」。安全率一覧表は古い版の計算書になく、いまの Batch は出す。

## ピックアップ pickup.pik

- 書式は FEMPython の PIK と同じ行で、先頭行 `Batch ver1.0.0`、Shift-JIS・CRLF。
- ピックアップは `reports/ExcelReportPickUpFile.vb` の `GetPickUpFile`。`Option_PickUpFileCase = 0`（既定）なら3つ：1＝L1地震動（`復旧性_L1震度step`）、2＝復旧性L2（`復旧性_最大応答step`）、3＝安全性L2（`安全性_最大応答step`）。どれも照査対象 ⑨断面力ピックアップ（`_解析対象(8)`）の全 Case について、ステップ 0〜そのステップの各部材の両端の M・S・N の最大・最小。`Option_PickUpFileCase > 0` だと普通地盤・液状化・応答変位法に分けた10個になる（コードで確認）。
- ピックアップの番号（1〜3）は抽出ケースの番号とは対応しない。
- 同じ入力で同じバイト（実アプリで確認）。大きさの例：部材6本で109行・11 KB、部材7本で127行・13 KB。
- 部材の番号は JRSNAP の骨組（NDU の MemberInfo）のもので、着目点は各部材の ITAN・JTAN だけ（途中点はない）。FrameWeb など別の骨組の部材番号とは合わない。

## 総括表 summary.xlsx

- 約27 KB。シートは応答値一覧表・設計総括表・安全率一覧表・直接基礎の4枚（計算書の最後の4ページと同じ）。
- zip の中の日時は 1980-01-01 で固定だが、`xl/workbook.xml` の `documentId`、各シート・図の `xr:uid`・`a16:creationId` の GUID と `docProps/core.xml` の `dcterms:modified` が毎回変わるので、同じ入力でもバイトが変わる（2026-10-19、2回作って比べた）。検査するならシート名の並びを見る。
