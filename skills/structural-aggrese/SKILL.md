---
name: structural-aggrese
description: Aggre-SE（Batch.exe、Docu-SE。structural-mcp の Batch サブモジュール）のプロジェクトXMLを読む・項目を画面と対応付ける・JRSNAP の解析結果（DB1 と同じ名前のファイル）と一緒に MCP の aggrese_inspect／aggrese_calculate か AggreSE.Headless の runner で照査・集計させる・Aggre-SE 自身の保存し直しで書式を確かめるときに使う。XML の文字コード（宣言は utf-16、中身は Shift-JIS）、_rbSpec・_rbJIban などの添字の意味（画面の並びや 0 始まりの順と違うものがあるので、推測せずこのスキルの表で確かめる）、DB1 の横に要るファイル（_Output_Chokukiso.csv、Aspect-SE_*.csv）、計算書 report.pdf・ピックアップ pickup.pik・総括表 summary.xlsx の構成と毎回変わる部分、JRSNAP の両端固定 M-θ 部材の Vmu・Vud（La が -999.999、Both_VmuVud）、直接基礎のステップ表（--foundation-steps）、SNAPDBLib で DB1 を画面なしで覗く方法、基礎の照査条件で SOIL-JR の .sdr（基礎照査連携データ）から杭基礎の制限値を取り込む仕組みと注意、Batch の版が変わって書式を追うとき、耐震照査の入力が Aggre-SE で読めるか調べるときにも使う。JRSNAP の解析そのものには使わない。
---

# Aggre-SE のプロジェクトXMLを扱う

Aggre-SE（Batch.exe、Docu-SE）は JRSNAP の解析結果（各 Case の `.DB1` と同じ名前のファイル）を、プロジェクトXMLの照査条件で集計・照査し、総括表・計算書・ピックアップを作る。structural-mcp は Batch を submodule として版を固定し、画面を出さない runner（`AggreSE.Headless.exe`）を MCP のツールで公開している。

- ソース（開発機のみ。structural-mcp の repo のルートから）：`Batch/Aggre-SE/`。runner は `Batch/Aggre-SE/Headless/`（使い方は同じフォルダーの README.md）。
- **Batch のファイルは変更しない**。試すときは XML と DB1 のフォルダーの複製を使う。
- 確認した版：Batch 5.3.0.1（FileVersion）、2026-10-18〜19。

## 読む

- 宣言は `encoding="utf-16"` だが、中身は **Shift-JIS・CRLF**（XmlSerializer の文字列を Shift-JIS の StreamWriter で書くため）。Batch・structural-mcp・runner はどれも Shift-JIS で読む。宣言を信じて UTF-16 で読まない。
- ケースの配列が長いので、同じ行をまとめて読む（字下げと値の空白はそのまま）：
  `iconv -f cp932 -t utf-8 <xml> | tr -d '\r' | uniq -c | sed -E 's/^ +1 //; s/^ +([0-9]+) /[x\1]/'`
- Python で値を取るときは `ET.fromstring(data.decode("cp932").replace('encoding="utf-16"', ""))`。
- 項目の意味と画面の対応（`_rbSpec` の (0)＝Ⅰ,Ⅱ両方 など、画面の並びと添字が違うものがある）は `references/project-xml.md`。

## DB1 の横に要るファイル

- DB1 と同じ名前の全ファイル（`.DB2`・`.R10` など。`.R10` などは SNAPDBLib が zip から展開する）。DB1 の横の同じ名前の `.xlsx`・`.csv` は Batch の出力で、入力ではない。
- 欠けても失敗しないので注意（Batch の PHC の見本で、runner で確認、2026-10-22）：**`.DB2` がないと `ok:true` のまま荷重変位と照査値が `-----` になる**。runner は DB2 がないと `SNAP_FILES_MISSING` で失敗する（Batch e463db8 から）。`.R10`・`.R12` がないと、総括表の文字列が一部変わる（R10 の損傷レベルの制限値と思われる）が、R10・R12 は見本の半分のケースにしかないので runner は確かめない。DB1・DB2・R10・R12 があれば、総括表・照査表は全部置いたときと一致した。
- `<DB1名>_Output_Chokukiso.csv`：直接基礎の照査値。**JRSNAP の基礎照査機能（`S_SubstCheck.exe`）が書く**。NDU に直接基礎の照査のデータ（`ChokuKisoNum`・`CHOKU_KISO`）があり、「基礎照査機能を起動しますか？」に「はい」と答えたときだけできる。ないとき Aggre-SE は DB1 から求める（`SNAPClass.vb`：`SetChokukisoDB` は CSV があれば読むだけで、`GetChokukisoJoint` などは `OutputInfo.OutChokukiso Is Nothing` のとき DB1 の値を使う。コードで確認）。**JRSNAP の基礎照査の値と、CSV なしで DB1 から求めた値は一致しないことがある**（作用は合い、抵抗側が違った例がある。原因は未切り分け。実アプリで確認、2026-10-19）。
- `_Output_PIC.csv`・`_直接基礎照査No1.csv` も同じ機能の出力だが、Aggre-SE は読まない。
- `Aspect-SE_*.csv`：任意スペクトルのとき（DB1 と同じフォルダー）。

## MCP で照査・集計させる（先にこちら）

1. `get_capabilities` で `aggrese` が使えるかを見る。runner の場所は `get_environment_template`（`engine: "aggrese"`）か環境変数 `STRUCTURAL_MCP_AGGRESE_RUNNER`。
2. `aggrese_inspect`（`inputPath` に XML）でケースの一覧と、任意スペクトル（地盤区分 9）で応答塑性率 μ が要るケース（`summary.spectralDuctility` の `source: "missing"`）と参考値を見る。μ は**利用者に確かめてから** `spectralDuctility: [{ "caseNumber": 1, "value": 2.5 }]` で渡す。推測しない。
3. `aggrese_calculate` で帳票を作る。引数と runner の引数の対応：`generateSummaryExcel`→`--summary-xlsx`（既定 true）、`generateReportPdf`→`--report-pdf`（既定 false）、`includeCheckTables`→`--check-tables`（既定 true、PDF を作るときだけ）、`generatePik`→`--pik`（既定 false）、`generatePileAnchorBarPdf`→`--pile-anchor-bar-pdf`（既定 false）。成果物は `read_artifact`（`.pik`・ケースごとの `.csv` は Shift-JIS なのでこちら）で取り、SHA-256 を確かめてから置く。
- XML と `SnapDBPath` の DB1（と横のファイル）は `STRUCTURAL_MCP_ALLOWED_ROOTS` の中に要る。MCP はそれらを job に複製し、XML は書き換えずに DB1 のパスだけを差し替えて runner に渡すので、手で複製しなくてよい（README.md「Aggre-SE（Batch）の総括表・計算書」、2026-10-19）。
- `--foundation-steps`（直接基礎のステップ表）は MCP のツールにない（`src/server.ts`、2026-10-19）。使うときは runner を直接呼ぶ（`references/foundation-steps.md`）。

## runner を直接呼ぶ（スクリプトから使うとき）

runner（`STRUCTURAL_MCP_AGGRESE_RUNNER`）は protocol v1。XML と DB1 のフォルダーを一時フォルダーへ複製し、`--snap-map` に `{"<Case index（0 始まり）>": "<DB1 の絶対パス>"}`（XML の `SnapDBPath` の全件と一致）を書く。

```powershell
& $exe inspect --input <copy.xml> --output-dir <空のフォルダー> --snap-map <map.json>
& $exe run --input <copy.xml> --output-dir <空のフォルダー> --snap-map <map.json> --summary-xlsx true --report-pdf true --check-tables false --pik false --pile-anchor-bar-pdf false
```

- 任意スペクトルの μ は XML に入らない。`{"<Case index（0 始まり）>": μ}` の JSON ファイルを書き、`--spectral-ductility <そのファイルの絶対パス>` で渡す（ないと `SPECTRAL_DUCTILITY_REQUIRED`）。MCP の `caseNumber` は 1 始まりで、MCP が 0 始まりに直して同じファイルを書く（`src/jobs.ts`、コードで確認 2026-10-19）。
- 成功は envelope の `ok: true` と `summary.cases[].aggregated`。`engineeringStatus` は `not_evaluated` で、OK/NG は `report.pdf` で見る。読めることと照査に合格することを混同しない。
- runner は DB1 のフォルダーに何も書かない。1〜2 Case の XML で計算書・総括表・ピックアップを作って 4 秒ほど（実アプリで確認、2026-10-19）。
- SNAPDBLib の固定の作業フォルダー（`%SystemDrive%\nwl\Docu-SE`、`%TEMP%\Temp002`）を使うので、同時実行は runner 側で直列になる。
- 成果物の構成と、毎回バイトが変わるもの・変わらないものは `references/outputs.md`。

## Aggre-SE 自身に保存し直させる（書式の確認）

`scripts/aggrese_project_roundtrip.cs` は、Batch.exe を参照して画面の「開く」「上書き保存」と同じ `Input.SetXmData` → `applyVersion` → `Input.GetXmlData` → Shift-JIS の StreamWriter を行う（画面の DataSave/DataLoad は通らない）。Batch.exe は runner と同じフォルダーにある。

```powershell
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /platform:x86 /out:<dir>\Roundtrip.exe <このスキルのフォルダー>\scripts\aggrese_project_roundtrip.cs
& <dir>\Roundtrip.exe <runner のフォルダー> <in.xml> <saved.xml>
```

- csc は **PowerShell から**呼ぶ。Git Bash は `/nologo` などをパスに書き換えて失敗する。
- 保存し直すと、名前空間の宣言の順（`xmlns:xsi` が先）、`Version`、`_dgLimitLevel_SIJI`・`_ParagraphLength` など、いまの Batch の書式に変わる。自前で XML を書くプログラムは「保存し直してもバイト列が変わらない」ことを確かめると、いまの Batch の書式に合っているかが分かる。
- Batch の版が変わったら、手元の XML をこれで保存し直して差を見る。

## 杭基礎の制限値に SOIL-JR の .sdr を取り込む

基礎の照査条件の画面（`ChildFormFoundationSetting`）の「SOIL-JR結果ファイル(*.sdr)」は、SOIL-JR の基礎照査連携データ（.sdr。書式は structural-jrsnap-soil スキルの「.sdr の書式」）から杭基礎の制限値を取り込む。runner と MCP にはない画面だけの機能。コードで確認、Batch 5f609a9（2026-10-23）。

- 読み取りは `Batch/Aggre-SE/datas/FoundationLinkData.vb`（`Read`・`Extract`・`Cells`）。画面の `SelectFoundationDB` で方向（橋軸・直角）を選ぶ。
- 取り込む値：Lv1（Rvd・Rud・δL・θL）、Lv2（Rvd・δL・θL）、Azen（Rvd・δL・θL）。Ver.5.3 では 安定レベル1(地震時)・安定レベル2・安定レベル3 の行、Ver.5.2 では 残留鉛直変位(L1)・(L2) と「地震時」の段から読む。Rud は引抜きが7列（回転杭）なら列5、6列なら列4。
- 普通は表「普通」の5列目の行0〜9に10個、液状化は表「液状化」の行0〜6に7個を書く（**液状化では Azen を書かない**）。
- 普通か液状化かは、Ver.5.3 では**ファイル名に「液状化」があるかだけ**で決める。名前を変えると逆の表に入る。
- ほかの注意（Batch の `docs/issues/`）：表題に「直角方向」があると直角方向を選んでも橋軸方向の値を読む（0009）、4行に満たないファイルは未処理の例外（0010）、数値は実行時のカルチャで読む（0011）、Ver.5.2 と 5.3 の対応は未確認（0012）。いずれも 2026-10-23 時点で未対応。
- テストは Batch の `tests/Aggre-SE.Test/FoundationLinkDataTests.cs`（`Category=FoundationLink`、見本の .sdr は普通の git にあり LFS 不要）。

## 詳しく

- `references/project-xml.md`：XML の項目と画面の対応、クラスと画面のソースの場所、配列の長さ。
- `references/outputs.md`：report.pdf・pickup.pik・summary.xlsx の構成、見出しの出どころ、毎回変わる部分、引数と成果物の対応、版による違い、両端固定 M-θ 部材の Vmu・Vud（DB1 の値と Aggre-SE の表示）。
- `references/foundation-steps.md`：直接基礎のステップ表（`--foundation-steps`）の列と step の番号、SNAPDBLib で DB1 を画面なしで覗く方法（`UnsafeLoadFrom`、値はフィールド）、Batch 側のテスト。

## 知見を足すとき

- Aggre-SE そのものの性質（項目の意味、画面との対応、runner の挙動、Batch の版による書式の違い）：このスキル（structural-mcp の `skills/structural-aggrese/`）を編集し、structural-mcp で commit する。開発機ではインストール先がこのフォルダーへのジャンクションなので、そのまま全案件に効く。
- WebPier がこの XML を書く・帳票を取り込む実装、決定、受入：WebPier の repo のスキル `webpier-aggrese`。
- 案件の判断・見本の読み替え：その案件の repo。
- インストール先がコピー（MSI の利用者）のときは編集しない。案件側に書いて開発者に伝える。
- コードで確かめたこと、実アプリで試したこと、推定を区別し、日付と Batch の版を残す。
