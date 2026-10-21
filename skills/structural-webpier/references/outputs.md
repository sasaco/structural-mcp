# 成果物の意味と新旧の確かめ方

確かめた版：WebPier `b6c349c`、structural-mcp `91d7aca`（2026-10-19）。段階ごとのファイル名は `references/stages.md`。

## MCP の job の中の配置

- `webpier_generate` の `artifacts[].relativePath` は `output/output/<ファイル>`（案件の `output/` に置くもの）、`output/export/<ファイル>`（案件の `export/`）と `output/post/<ファイル>`（案件の `post/`）。JRSNAP の結果フォルダーは `output/post/線路方向_JRSNAP/<ファイル>` のように中のファイルが1つずつ並ぶ。
- `artifactId` は WebPier の役割から：`0612-pdf`・`0612-xlsx`・`0612-json`・`0612-pik`・`0612-pik-provenance`。JRSNAP の結果は `0711-jrsnap`・`0711-jrsnap-2`…。
- job は `<pathPolicy.jobRoot>\<日付>\<jobId>\` で、`manifest.json`（`get_job` と同じ内容。各成果物のバイト数と SHA-256）と `output\` がある。

## `output/`

| ファイル | 中身 |
|---|---|
| `<段階>_<名前>.pdf` | 計算書（A4 縦・白黒。ページ番号なし） |
| `<段階>_<名前>.json` | 結果 JSON：`schema_version`・`stage`・`input`（入力のファイル名と SHA-256）・`implementation_sha256`・`result`。0611 などは `section_check`（Capacita を実行したこと、`engineering_status: not_evaluated`、飛ばした節）、0711・0721 は `seismic_check`（Aggre-SE、Case ごとの集計の有無）、0612・0622 は `result.engineering_status` |

## `export/`

| ファイル | 中身 |
|---|---|
| `<段階>_<名前>.xlsx` | 方眼Excel：計算書のうち WebPier が組む頁を、1冊1シートに書いたもの（GridLayoutPdf 0.2 の共通グリッド。セルが方眼のマスで、文字・式の項・表の罫線がセルに入る）。他のプログラムの頁（FEMPython の荷重図、Capacita・JRSNAP の頁）は入らない。0711・0721 は Aggre-SE の帳票そのものなので無い。WebPier の生成で strict に書くので、セルに置けない部分があれば生成ごと止まる |

## `post/`

| ファイル | 中身 | 文字コード |
|---|---|---|
| `線路方向.json`・`線路直角方向.json` | FrameWeb 入力（FrameWebforCS の保存形式） | UTF-8 |
| `線路方向.pik`・`*_ピックアップ変位量.csv`・`*_ピックアップ反力.csv` | FEMPython の骨組解析のピックアップ（0611・0612 で共有） | UTF-8 |
| `線路方向.wdj`・`線路直角方向.wdj` | Capacita が取り込んだ柱の WDJ（Capacita の画面で開ける） | UTF-8 |
| `線路方向フーチング.wdj`・`片持ち梁.wdj` など | WebPier が書いた断面力入力モードの WDJ | UTF-8 |
| `線路方向.ndu`・`線路直角方向.ndu` | JRSNAP 5.2-L03 の入力 | CP932・CRLF |
| `線路方向_JRSNAP/` | JRSNAP の .NDT と解析結果（JRSNAP の付けた名前のまま。`.DB2` は1ケース数十MB） | — |
| `線路方向.xml` | Aggre-SE のプロジェクト（宣言は utf-16、中身は Shift-JIS）。横の `_JRSNAP` フォルダーの DB1 を相対パスで指すので、Aggre-SE の画面や `aggrese_calculate` でそのまま開ける | Shift-JIS |
| `線路方向_Aggre-SE.pik` | Aggre-SE の断面力ピックアップ（1＝L1地震動、2＝復旧性L2、3＝安全性L2。全 Case の包絡） | Shift-JIS |
| `線路方向_Aggre-SE.xlsx` | Aggre-SE の総括表（応答値一覧表・設計総括表・安全率一覧表・直接基礎） | — |
| `線路方向_Aggre-SE_直接基礎.csv` | 直接基礎の支点の JRSNAP の全出力ステップ（0800 が Rvd到達ステップを読む） | UTF-8 |
| `<ファイル>.provenance.json` | 付帯JSON（下） | UTF-8 |

`post/線路方向.pik`（FEMPython）と `post/線路方向_Aggre-SE.pik`（Aggre-SE）は別物。

## 付帯JSON（`*.provenance.json`）

`post/` の各ファイルの横にあり、次のものを記録する：そのファイルの名前と SHA-256、`input`（入力のファイル名と SHA-256）、`implementation_sha256`（WebPier のソースと組版ライブラリ・書体のバイトから求めた値）、`selected_stages`、同じ世代の全成果物（`artifacts`：役割・出力先・ファイル名・SHA-256）、エンジンごとの事実（`frame_analysis`・`section_check`・`nonlinear_analysis`・`seismic_check` などに runner の `engine`・`engine_version`）。

## 新旧を確かめる

- **入力と合っているか**：付帯JSON・結果 JSON の `input.sha256` を、案件の `pre/input.json` の SHA-256 と比べる（PowerShell の `Get-FileHash -Algorithm SHA256`）。違えば、いまの入力で作ったものではない。
- **同じ世代か**：付帯JSONの `artifacts` に並ぶファイルの SHA-256 が、いまのファイルと合うか。
- **同じ WebPier で作ったか**：`implementation_sha256` を、新しく生成した `summary.implementationSha256` と比べる。WebPier の置き場所（venv のパス）や PC の git の改行の設定でも変わるので、違っても計算が違うとは限らない。
- 毎回バイトが変わるもの（同じ入力でも SHA-256 で新旧を判断しない）：差し込みページを含む計算書（0610・0620 の FEMPython の荷重図、0611・0621・0810・0820・0910 の Capacita のページ、0710・0720 の JRSNAP の図（日付入り）、0711・0721 の Aggre-SE の帳票）、Aggre-SE の xlsx、JRSNAP の結果、およびそれらの SHA-256 を記録する付帯JSON。それ以外（WebPier だけで決まる計算書・方眼Excel・結果 JSON・NDU・FrameWeb 入力・WDJ・ピックアップ）は、同じ入力・同じ WebPier なら同じバイト。
- 1つの段階だけを作った生成は、ほかの段階の前のファイルを消さずに残す。どの世代のものかは付帯JSONで見分ける。
