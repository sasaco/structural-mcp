---
name: structural-aggrese
description: Aggre-SE（Batch.exe、Docu-SE。structural-mcp の Batch サブモジュール）のプロジェクトXMLを読む・項目を画面と対応付ける・JRSNAP の解析結果（DB1 と同じ名前のファイル）と一緒に MCP の aggrese_inspect／aggrese_calculate か AggreSE.Headless の runner で照査・集計させる・Aggre-SE 自身の保存し直しで書式を確かめるときに使う。XML の文字コード（宣言は utf-16、中身は Shift-JIS）、_rbSpec・_rbJIban などの添字の意味（画面の並びや 0 始まりの順と違うものがあるので、推測せずこのスキルの表で確かめる）、DB1 の横に要るファイル（Aspect-SE_*.csv。_Output_Chokukiso.csv は読まない）、.EMG の軸力適用範囲外の注記と備考、計算書 report.pdf・ピックアップ pickup.pik・総括表 summary.xlsx の構成と毎回変わる部分、JRSNAP の両端固定 M-θ 部材の Vmu・Vud（La が -999.999、Both_VmuVud）、直接基礎のステップ表（--foundation-steps）、SNAPDBLib で DB1 を画面なしで覗く方法、基礎の照査条件で SOIL-JR の .sdr（基礎照査連携データ）から杭基礎の制限値を取り込む仕組みと注意、Batch の版が変わって書式を追うとき、耐震照査の入力が Aggre-SE で読めるか調べるときにも使う。JRSNAP の解析そのものには使わない。
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
- `<DB1名>_Output_Chokukiso.csv`：直接基礎の照査値。JRSNAP の基礎照査機能（`S_SubstCheck.exe`）が書くが、**Aggre-SE（2026-10-23 以降の Batch）はこの CSV を読まない**（読むコードを削除。以前は形式の不一致で例外になり、空の `Catch` で握りつぶされて、一度も読めずに DB1 から求めていた。Batch の issue 0015・ADR 0002）。直接基礎の照査値は常に DB1 から求める。**CSV と DB1 から求めた値は一致しない**（5.3 の Rvd 最大 31%・Mmd 最大 17%、岩盤の Hd は 246 ステップで符号が逆。どちらが基礎照査機能の式に合うかは未確認。実アプリで確認、2026-10-23）。CSV を置いても結果は変わらない。
- `_Output_PIC.csv`・`_直接基礎照査No1.csv` も同じ機能の出力だが、Aggre-SE は読まない。
- `Aspect-SE_*.csv`：任意スペクトルのとき（DB1 と同じフォルダー）。
- **JRSNAP の等価せん断スパン法の `<DB1名>.CSV` は渡さない**：runner は計算書（`--report-pdf true`）を作るとき、DB1 の横に `<DB1名>.csv`・`.xlsx`（Aggre-SE の Case ごとの出力の名前。Windows では大文字小文字を区別しない）があると `--check-tables false` でも `OUTPUT_CONFLICT` で断る（`AggreSeRunner.cs`）。JRSNAP は杭頭部に等価せん断スパン法を使う解析で同じ名前の帳票を書くので、Aggre-SE に渡す複製から外す（Aggre-SE はこれを読まない。WebRamen R6d で確認、2026-10-26）。

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

## .EMG の「軸力適用範囲外」と照査表の備考

- Aggre-SE は `<DB1名>.EMG`（解析メッセージ）の **「高軸方向圧縮力を受ける要素が発生しました．非線形番号＝N 発生ｽﾃｯﾌﾟ＝S」** の行を読む（`CalculationCase.vb: 軸力適用範囲の判定`）。N は AP 番号で `GetMemberNo` で部材番号にする。旧い書式（「作用軸力が適用範囲外」＋次の行にステップと AP 番号）も読むが、見本の .EMG 46 ファイル（5.2・5.3）に旧い書式はない（Batch の issue 0017）。圧縮力だけが対象で、「高軸方向引張力」「除荷剛性領域」の行は読まない（引張を入れるかは未決）。読めなかった行・例外は `HeadlessHost.Notify` で通知する。
- 出力に出るところ：report.pdf の荷重変位のページと「水平震度と水平変位」の表の「状態」欄（「要素番号Nの作用軸力が適用範囲外」。増分ステップ S の行）、`cases/case-NN.csv` の同じ行、照査表（M-φ）の備考欄「軸力適用範囲外」。備考は `cls損傷レベル.備考`（4 欄）の空いている最初の欄に付く（高軸圧縮発生・除荷剛性領域は消さない。`Set軸力適用範囲外`、issue 0018）。
- 損傷レベルの照査は **R10 の経路（`R10損傷レベルの照査`）と DB2 の経路（`DB2損傷レベルの照査`）がある**。R10 があるケースは R10 を通る（01_PHC など）ので、備考や注記を足すときは両方を通る場所（決定ケースを選ぶ前）に付ける。
- 01_PHC（V53）の確認（実アプリ、2026-10-23）：ステップ 20・23・28・34 の行に要素番号 49〜55 の注記が付く。EMG のステップが DB1 のステップと同じ数え方（0 始まり）かは未確認。

## 通知が出たら結果を信用しない場合

- **応答塑性率 μ が求まらない**（SNAPDBLib が「該当せず」を返す。例：液状化 PL＞20 で M6.5 以上の震源エリアが「存在しない」）：通知「塑性率の取得に失敗しました…」が出るだけで `ok: true` のまま、安全性の μ・δr・Khmax が 0 になり、ステップ 0 の値で照査して OK と出る。通知が出たケースの安全性の値と OK は信用しない（Batch の issue 0003。直さないと決めた、2026-10-23）。

## 震度の低減係数 α・任意スペクトル・JRTT 式の適用範囲外（Batch の issue 0002・0004・0005、2026-10-23）

直した変更は Batch の `sasa/dev` に取り込み済み（`087b7f4`）。これより前の版の Batch では直っていない。

- **α が効くのは「スペクトルⅡで M6.5 エリアが存在する」ときだけ**（SNAPDBLib の `CalcOutouMyu` の仕様。M6.5 エリアが「不明」では α は無視され、α＝1 と同じ結果になる。0007）。α を 0.8 などにして結果が変わらないときは、まずこの条件を疑う。
- **JRTT 式が適用範囲外**（La/d≧2 など）で SNAP 準拠に戻るとき、せん断耐力の照査の Vud は、元の耐力を `Sendan.Vyd／部材本数` にそろえた値を使う（以前は `StepCtrl(istep).MemberItem.Vyd` で、部材本数が 2 以上だと過大。06 で判定が NG→OK に変わるものがあった）。
- **任意スペクトル（地盤区分 9）の杭基礎の安定レベル1**：L1 の震度が求まらない（`復旧性_L1震度 > 0` でない）ときは `-----`（以前はステップ 0 の値で OK と出ていた）。

## ⑥ L1 と ⑦ 基礎の安定が出すもの（コードで確認、Batch 5.3.0.1、2026-10-28。WebRamen Q47）

- **⑦（`_解析対象(6)`）** だけが杭基礎・直接基礎の安定の照査を動かす（`CalculationFoundation.vb` の `Is安定計算`）。照査位置（`dgReactAtPoint`・`dgDispAtPoints`）と制限値（.sdr）があっても、⑦ のない Case では「杭基礎の照査」の表は `-----` のまま。
- 安定レベル1（復旧性 L1 の鉛直支持・引抜き・水平変位・回転角）の行は **⑥（`_解析対象(5)`）と `復旧性_L1震度 > 0`** のときだけ作る。復旧性L2・安全性の行は ①・② が要る。
- ⑥ のとき KhL1（`復旧性_L1震度`）は、慣性力法の Case なら `GetL1地震動(等価固有周期)`（地盤区分ごとの L1 スペクトル、`CalculationCase.vb`）、応答変位法の Case なら最終ステップの震度。⑥ のない Case の総括表の KhL1 は `-----`。地盤区分（`_rbJIban`）のほかに入力は要らない（任意スペクトルは上の節）。
- ⑥・⑦ は構造物全体系の降伏（`Set降伏点`、`CalculationCase.vb` 791〜893）を変えないので、Khy・Kheq・δeq・Teq は ⑥・⑦ の有無で変わらない（杭が先に .sdr の制限値に達して全体系の降伏になる判定は照査項目によらない）。
- 小さな柱列骨組（WebRamen の受入 `tests/acceptance/test_0740_column_line.py`）で ①②⑥⑦ にして、どの Case も KhL1 が数値で出ることを本物で確かめた（2026-10-28）。

## 同等な断面・空の Catch（テストで確かめたこと）

- **57≡52 は同じ出力**：同じ .ndu で杭の `SectJikuNum` の第7フィールド（密帯鉄筋を考慮）だけを外すと、.ndt は断面コードの 1 行（57／52）しか違わず、Aggre-SE の出力（総括表・照査表・応答値・PDF）は DB1 の名前と SHA を除いて同じ（Batch の `09_同等な断面(V53)`、`EquivalentSectionTests`）。510≡51（補強で解析結果が変わる）・301≡300（CFT 矩形と円形）・540≡54（鉄筋の有無）は同じ寸法・配筋の組が作れず、比べない。
- `ExcelReport.vb` の空の `Catch`（損傷レベル・基礎の制限値）：制限値の行の指定が範囲外だと部材は落ちるが、あとで `CALCULATION_FAILED` になる。杭基礎の制限値（`dgLimitValue0`）が空欄・数字でないと、その項目の照査は通知なしに「-----」になる（`ok: true`、空欄は「照査しない」と読める）。Batch の `ExcelReportCatchTests`。

## 画面なしで帳票を確かめる

- structural-mcp のルートで `node scripts/smoke-aggrese.mjs "<絶対パス.xml>" --outputs summary,report`。**`npm run smoke:aggrese` は括弧（`(V53)`）を含むパスが cmd で壊れる**ので、ビルド済みなら node を直接呼ぶ。出力は `.structural-mcp/aggrese-smoke-*/client-output/`。
- report.pdf の見た目は、`uv run --no-project --with pymupdf python` で `pymupdf.open(...)[n].get_pixmap(dpi=80).save("p.png")` として画像にして見る（pdftotext は日本語フォントなしで文字化け、Read ツールの PDF 読み込みは pdftoppm がないと失敗）。
- Batch のテストの回し方・ゴールデンの作り直しは Batch の `tests/Aggre-SE.Test/README.md`。ゴールデンの diff が「備考の追加だけ」などになっているかは `git diff -U0` の行を種類ごとに数えて確かめる。

## 杭基礎の制限値に SOIL-JR の .sdr を取り込む

基礎の照査条件の画面（`ChildFormFoundationSetting`）の「SOIL-JR結果ファイル(*.sdr)」は、SOIL-JR の基礎照査連携データ（.sdr。書式は structural-jrsnap-soil スキルの「.sdr の書式」）から杭基礎の制限値を取り込む。コードで確認、Batch 5f609a9（2026-10-23）。runner（`--sdr <絶対パス> --sdr-direction axial|transverse`。2 つは一緒に。axial＝橋軸方向、transverse＝直角方向）と MCP（`aggrese_inspect`／`aggrese_calculate` の `sdrPath`・`sdrDirection`）からも同じ読み取りを使える（WebPier 決定94、2026-10-25）。runner は `FoundationLinkData` で読んで、メモリ上の `dgLimitValue0` の「普通」の行 0〜9 に入れる（XML は書き換えない）。照査位置（反力・変位の節点）があり制限値が空の杭基礎の XML に `--sdr` がないと `SDR_REQUIRED`、杭基礎でない XML に付けると `INVALID_ARGUMENT`、読めない・液状化時用の .sdr は `INVALID_SDR`。制限値を保存済みの XML は `--sdr` なしでそのまま走る。.sdr の版と DB1 の版が違う警告、ファイル名と中身の食い違い（0008）は runner の警告に出る。

- 読み取りは `Batch/Aggre-SE/datas/FoundationLinkData.vb`（`Read`・`Extract`・`Cells`）。画面の `SelectFoundationDB` で方向（橋軸・直角）を選ぶ。
- 取り込む値：Lv1（Rvd・Rud・δL・θL）、Lv2（Rvd・δL・θL）、Azen（Rvd・δL・θL）。Ver.5.3 では 安定レベル1(地震時)・安定レベル2・安定レベル3 の行、Ver.5.2 では 残留鉛直変位(L1)・(L2) と「地震時」の段から読む。Rud は引抜きが7列（回転杭）なら列5、6列なら列4。
- 普通は表「普通」の5列目の行0〜9に10個、液状化は表「液状化」の行0〜6に7個を書く（**液状化では Azen を書かない**）。
- runner の `--sdr-liquefied <液状化時用の .sdr>`（`--sdr` と `--sdr-direction` と一緒に）は、この「液状化」の表を `dgLimitValue0` の行 10〜16 に入れる（決定95）。XML に液状化の Case（`dgEkijoCase1`・`dgEkijoCase21`・`dgEkijoCase2` のどれかが -1）があり照査位置があって液状化の行が空なら `--sdr-liquefied` が要り（なければ `SDR_REQUIRED`）、液状化の Case がないのに付けると `INVALID_ARGUMENT`、取り違えたファイルは `INVALID_SDR`。制限値の添字（`CalculationFoundation.vb`）：0〜3 復旧性L1（Rvd・Rud・δL・θL）、4〜6 復旧性L2、7〜9 安全性、10〜16 液状化（10〜13 L1、14〜16 復旧性L2）、17〜23 と 24〜30 は液状化の L2 スペクトルⅠ・Ⅱの Case の L1 相当と安全性（空なら通常の値）。MCP は `sdrLiquefiedPath`。
- 普通か液状化かは、Ver.5.3 では選んだ方向の【水平変位の照査】の 安定レベル3 の指標に「≦」があるか（液状化時用だけ付く）で決め、ファイル名は使わない。名前の「液状化」と食い違うと取り込んだあとに警告を出す（0008）。Ver.5.2 は「地震時」「液状化時」の段で決める。
- 読み方（Batch の `docs/issues/`、2026-10-23 に対応）：方向の見出しは `(1)橋軸方向`・`(2)直角方向` の完全一致で探す（0009）、4行に満たない・3〜4行目が8列未満のファイルは読み込み失敗（0010）、数値は InvariantCulture で読む（0011）。Ver.5.2 と 5.3 の対応は確認済みでこのとおり（0012）。段の探し方は選んだ方向の段の中に限った（0013、対応済み）。
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
