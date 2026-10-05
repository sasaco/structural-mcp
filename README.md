# structural-mcp

`FEMPython`、`Capacita`、`SoilStructure` の構造解析・照査機能を、Codex などの MCP client から利用するためのローカル STDIO MCP gateway です。各計算エンジンの式はこのリポジトリへ再実装せず、Git submodule として固定した各プロジェクトの非対話 entry point を呼び出します。

## 公開対象

| Submodule | MCP で扱う領域 | 主な成果物 | 現在の状態 |
|---|---|---|---|
| [`FEMPython`](./FEMPython/) | 骨組・有限要素解析 | 解析結果 JSON、PIK、PDF | FrameWebforCS非対話runner接続済み（experimental） |
| [`Capacita`](./Capacita/) | RC・鋼部材の断面照査 | 結果 JSON、PDF、Markdown、Excel | 既存 adapter あり。旧 runner path から submodule への移行中 |
| [`SoilStructure`](./SoilStructure/) | 地盤・杭の計算、SNAP連携、地盤応答変位 | 中間結果 JSON、Excel、PDF、SDC、JOT | MCP adapter 接続済み。headless runner を個別設定して利用 |

> [!NOTE]
> `WebDan2` は旧リポジトリ名です。現在の正式なリポジトリ名は `Capacita` で、RC 計算コアは `RcDan`、鋼部材計算コアは `SteelDan`、統合アプリケーションは `WebDanforCS` に整理されています。互換性維持のため、現行 MCP の tool ID と環境変数には `webdan` という旧名称が残っています。

## 現在の MCP interface

ルートの TypeScript server には、FEMPython、Capacita、SoilStructure の protocol v1 runner を接続できます。

| Tool | Purpose | Output |
|---|---|---|
| `get_capabilities` | engine の利用可否、readiness、制限を確認 | capability 一覧 |
| `get_environment_template` | AIが `.env` を作成するときのrunner設定名と推奨絶対パスを取得 | dotenv template、pathの読取可否 |
| `fempython_get_runner_contract` | FrameWebforCS runnerの起動方法・PDF項目・PICKUP CSV・成果物取得手順を取得 | runner path、command、artifact仕様 |
| `fempython_calculate` | FrameWebforCS保存JSONを再計算 | `result.json`、任意 `pickup.pik`、`report.pdf`、`pickup-displacement.csv`、`pickup-reaction.csv` |
| `webdan_inspect` | WDJをCapacitaのdomain modelで読取り、入力を正規化 | 部材・算出点・配筋・材料・断面力・計算条件、診断 |
| `webdan_validate` | WDJの構造・参照・選択・主要な重複fieldを検証 | 検証結果、診断 |
| `webdan_compose_wdj` | 既存WDJへ明示された意味変更を適用 | 新しいWDJ、変更差分、検証結果 |
| `webdan_calculate` | Capacita の RC 断面照査を実行 | 要約、`result.json`、PDF または Markdown、任意 XLSX |
| `steeldan_calculate` | Capacita の鋼部材照査を実行 | 照査要約、`result.json`、任意 PDF |
| `soilstructure_get_schema` | document schemaVersion 1、単位、operation別必須sectionを取得 | JSON Schema、入力例 |
| `soilstructure_get_runner_contract` | standalone script用のrunner契約を取得 | command、artifact、文字コード、Python雛形 |
| `soilstructure_validate` | 対象operationの入力をSoilStructure本体で事前検証 | path付き診断、artifactなしのjob |
| `soilstructure_calculate` | SoilStructure document JSON から杭計算を実行 | 計算要約、`result.json`、任意 PDF・XLSX |
| `soilstructure_export_sdc` | 杭計算と `sdcExport` 設定からSNAP連携データを生成 | `result.json`、通常・液状化L1/L2 SDC |
| `soilstructure_ground_displacement` | `groundDisplacement` 設定からL1/L2地盤応答変位を計算 | `result.json`、任意 PDF、任意 L1/L2 JOT |
| `get_job` | 過去の job を取得 | manifest と artifact metadata |
| `read_artifact` | PDF・PIK等の検証済み成果物をbyte範囲で取得 | Base64、offset、EOF、総byte数 |
| `read_text_artifact` | JSON・Markdown・text 成果物を範囲読取 | UTF-8 text fragment |

各 runner は独立して検出されるため、一つが未導入でも MCP server と他の engine は利用できます。FEMPythonはWindows上のFrameWebforCSと同じ計算・PICKUP・印刷処理を使います。

計算 tool は PDF や巨大な結果を MCP 応答へ埋め込みません。短い summary と artifact metadata を返し、完全な結果は job directory へ保存します。`executionStatus` と `engineeringStatus` は別項目です。process が正常終了しても、照査結果が `not_ok` になることがあります。

## 構成

```text
Codex / MCP client
        |
        | MCP over STDIO
        v
structural-mcp (Node.js 24 / TypeScript)
        |
        +-- FEMPython adapter ------> FrameWebforCS.Headless / FEMPython
        +-- Capacita adapter -------> RcDan / SteelDan （既存互換 tool）
        `-- SoilStructure adapter --> SoilPile / SoilDisp / headless runner
```

runner は 1 tool call ごとに別 process で起動する方針です。stdout は小さな JSON envelope に限定し、完全な計算結果や帳票は artifact として管理します。

## clone と submodule

新しく取得する場合は submodule を同時に clone します。

```powershell
git clone --recurse-submodules https://github.com/sasaco/structural-mcp.git
cd structural-mcp
```

通常の clone 後に submodule を取得する場合、または登録 commit へ揃える場合は次を実行します。

```powershell
git submodule update --init --recursive
```

submodule はそれぞれ検証済み commit に固定されています。各 submodule 内で branch を進めても、ルート側の参照 commit を更新しない限り他の利用者へは反映されません。

## 必要環境

- Node.js 24 以上（MCP server）
- Python 3.12 と `uv`（FEMPython）
- .NET SDK 8 以上（Capacita）
- .NET SDK 10（SoilStructure。`global.json` を参照）
- Windows（現在の各アプリケーションと帳票生成環境）

各 engine 固有の構築・検証手順は、[FEMPython README](./FEMPython/README.md)、[Capacita README](./Capacita/README.md)、[SoilStructure README](./SoilStructure/README.md) を参照してください。

## MCP server の build

```powershell
npm ci
npm run build
dotnet build .\Capacita\WebDanforCS\Headless\WebDanforCS.Headless.csproj -c Release
uv sync --project .\FEMPython\FrameWeb --locked
dotnet build .\FEMPython\FrameWebforCS\Headless\FrameWebforCS.Headless.csproj -c Release
```

現行の Capacita adapter は、protocol v1 互換の `WebDanforCS.Headless` runnerを `STRUCTURAL_MCP_WEBDAN_RUNNER` で受け取ります。未指定時は、このリポジトリ内のRelease buildを使用します。

Capacita runner のRC commandは `inspect-rc`、`validate-rc`、`compose-rc`、`run-rc` です。`webdan_compose_wdj` は入力元を直接上書きせず、MCPのjob directoryに `generated.wdj` を生成します。対象プロジェクトへの配置と命名はclient側のskillが担当します。

SoilStructure adapter は `STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER` の runner に、次の非対話commandで接続します。

```text
validate --input <file> --output-dir <empty-dir> --operation pile|sdc|ground
run --input <file> --output-dir <empty-dir> --generate-pdf true|false
run --input <file> --output-dir <empty-dir> --generate-pdf true|false --xlsx-output <empty-dir>/report.xlsx
export-sdc --input <file> --output-dir <empty-dir>
run-ground-displacement --input <file> --output-dir <empty-dir> --generate-pdf true|false --generate-jot true|false
```

入力には allowed root 内の `.soilstructure.json` / `.json` path、または inline JSON を指定できます。`inputPath` と `input` は同時には指定できません。SDC出力は4（鋼管ソイルセメント杭）、5（回転杭）、6（場所打ち杭）に対応します。回転杭では `sdcExport.steelPipeDiameterM` を `pile.diameterM` と一致させ、`steelPipeThicknessMm` と `corrosionAllowanceMm` を設計入力として明示してください。出力には押込み側に加えて引抜き側のf/g杭先端ばね・杭先端支持力を含みます。SDCはCP932・CRLFで通常版と、入力に液状化低減係数がある場合はL1/L2版を生成します。JOTもCP932・CRLFで、文書の `includeL1` / `includeL2` に従って最大2ファイルを生成します。

client AIは、入力作成前に`soilstructure_get_schema`、standalone Python作成前に`soilstructure_get_runner_contract`を呼びます。設計条件が不足している場合は推測せず、不足fieldをユーザーへ確認します。作成後はJSONをinlineで`soilstructure_validate`へ渡して検証できます。standalone PythonはSoilStructure runnerを直接呼び、runnerが返すartifactのbytesとSHA-256を検証してから、指定されたSDC/PDFへ原子的に配置します。この経路では、MCP serverに対象プロジェクトのドライブをallowed rootとして登録する必要はありません。

別プロジェクトからrunnerを直接呼ぶスクリプトの `.env` をAIに作成させる場合、AIは最初に `get_environment_template` を呼びます。応答には設定キー、現在の推奨絶対path、runnerが読み取り可能かどうか、およびそのまま保存できるdotenv形式の `content` が含まれます。MCPは既存の `.env` や秘密情報を読み取りません。

### FrameWebforCSの計算・PIK・PDF・PICKUP CSV出力

`fempython_calculate` はFrameWebforCSで保存したJSONを受け取り、保存済み結果を使わず再計算します。`generatePik`、`generatePdf` は既定で `true` です。PIKには2次元モデルとPICKUP定義が必要です。PDFの既定項目は、入力データ・断面力・pickup断面力・変位・pickup変位です。`pdfSections` に次のIDの部分集合を指定すると掲載項目を変更できます。

```json
{
  "input": "<クライアントが読み取ったFrameWebforCS JSONの文字列>",
  "generatePik": true,
  "generatePdf": true,
  "pdfSections": ["input", "section_force", "pickup_section_force", "displacement", "pickup_displacement"]
}
```

入力・最終出力のファイル操作はクライアントが担当できます。例えばKドライブのJSONをクライアントが読み取り、`input` に文字列として渡します。この経路では、クライアントの作業フォルダをMCPのallowed rootに登録する必要はありません。

変位・反力のPICKUP CSVは2D/3Dに対応し、次のフラグで個別に追加できます。どちらも既定値は `false` です。CSVのみ必要な場合は `generatePik` と `generatePdf` を `false` にします（PIKは2D専用）。

```json
{
  "input": "<クライアントが読み取ったFrameWebforCS JSONの文字列>",
  "generatePik": false,
  "generatePdf": false,
  "generatePickupDisplacementCsv": true,
  "generatePickupReactionCsv": true
}
```

`generatePickupDisplacementCsv` は `pickup-displacement.csv`、`generatePickupReactionCsv` は `pickup-reaction.csv` を生成します。片方だけ必要な場合は、そのフラグだけ `true` にします。どちらも `text/csv; charset=utf-8`、BOMなしUTF-8です。17列にPICKUP番号・着目成分・節点番号・最大/最小の出典COMBINE番号と、それぞれに連動する6成分を保持します。数値は表示用に丸めたりmmへ変換したりせず、ヘッダーに記載された解析単位（回転はrad）のまま出力します。解析結果の単位が未指定ならヘッダーも `unspecified` です。反力CSVの対象は解析結果に反力がある節点です。

応答の `jobId` と各 `artifactId` を `read_artifact` に渡し、返された `base64` を復号して `offsetBytes` 順に連結します。`nextOffsetBytes` を次の読取位置にし、`eof: true` まで取得します。総byte数とSHA-256を計算応答のmetadataと照合した後、`pickup.pik` を依頼されたPIKパス、`report.pdf` を依頼されたPDFパスへクライアント側で保存します。MCPはクライアントの保存先パスを受け取りません。`read_artifact` は成果物の改変・job外への参照を拒否します。

CSVも同じ手順で取得し、クライアントが指定されたCSVパスへ保存します。要求した成果物が欠落した場合は計算成功として返しません。

runnerは `FrameWeb/src` と `FrameWeb/.venv` を探索するため、FEMPythonチェックアウト内の標準build先に配置してください。Windows x64、.NET 10 Desktop Runtimeと `uv sync --project FEMPython/FrameWeb --locked` で準備したPython環境が必要です。既定以外のrunnerは `STRUCTURAL_MCP_FEMPYTHON_RUNNER` で指定できます。単体起動の詳細は `fempython_get_runner_contract` と [headless README](./FEMPython/FrameWebforCS/Headless/README.md) を参照してください。

CSV対応を反映するにはrunnerとMCPをbuildし、接続中のMCPサーバーを再起動します。

```powershell
dotnet build FEMPython/FrameWebforCS/Headless/FrameWebforCS.Headless.csproj -c Release
npm run build
```

実runnerとMCPの接続確認は次のコマンドで行います。クライアントが入力をinlineで渡し、3成果物をMCPから分割取得して検証します。入力元や既存出力は上書きせず、検証ファイルは `.structural-mcp/frame-smoke-*/client-output/` に残します。計算toolのclient timeoutはrunnerのtimeoutより長く設定してください（このスクリプトは240秒）。

```powershell
npm run smoke:fempython -- 'K:\レールウェイコンサルタント\26_ピット\計算書\02_pre\05_線路直角方向の計算\線路直角方向.json'
```

`--exports displacement` または `--exports reaction` で一方のCSVのみ、`--exports node-csv` で両CSV、`--exports all` でPIK・PDF・両CSVを取得します（いずれも `result.json` を含みます）。CSV全行と出典COMBINE番号・連動する6成分の照合には、追加ライブラリ不要の検証スクリプトを使います。

```powershell
npm run smoke:fempython -- '<input.json>' --exports node-csv
uv run --project FEMPython/FrameWeb --locked python -B scripts/verify-frameweb-node-csv.py '<outputDirectory>'
```

返された `outputDirectory` を次の検証スクリプトへ渡すと、PIK全行の着目位置・出典ケース・連動する断面力を結果JSONと照合し、PDFの5項目と内部節点名の欠落を検査します。`--render` は全ページの一覧画像と代表ページを `qa/` に生成します。検証用依存は `uv` の一時環境へ導入され、計算プロジェクトの依存は変更しません。

```powershell
uv run --no-project --with pymupdf --with pillow python scripts/verify-frameweb-exports.py '<outputDirectory>' --render
```

### 杭計算のExcel・PDF・SDC出力

`soilstructure_calculate` の `generateExcel` は既定で `false`、`generatePdf` は既定で `true` です。両方を `true` にすると、同じ計算済みExcelシートから `report.xlsx` と `report.pdf` を生成します。Excelだけを生成する場合は `generatePdf: false` を指定します。Excel生成は杭種4/5/6に対応し、Windows、Microsoft Excel、`--xlsx-output` 対応のSoilStructure runnerが必要です。

```json
{
  "inputPath": "K:\\レールウェイコンサルタント\\26_ピット\\計算書\\02_pre\\04_地盤のモデル化\\04_地盤のモデル化.soilstructure.json",
  "generateExcel": true,
  "generatePdf": true
}
```

SDCは同じ入力で `soilstructure_export_sdc` を呼び出します。成果物はMCPのjob directoryに保存し、応答には相対パス・byte数・SHA-256を返します。クライアントは検証済み成果物を指定されたExcel・PDF・SDCの保存先へ配置します。MCP自体は任意の出力先パスを受け取りません。Kドライブの入力を `inputPath` で渡す場合は `STRUCTURAL_MCP_ALLOWED_ROOTS` に対象フォルダーを追加するか、クライアントで読み取ったJSONを `input` へinlineで渡してください。

standalone Python雛形では `run_soilstructure(..., generate_excel=True)` により一時ディレクトリへExcelを生成し、`destinations` の `report.xlsx` / `report.pdf` に指定したパスへ検証後に配置できます。

実runnerでの接続確認は `npm run smoke:soilstructure -- <入力JSONの絶対パス> pile-excel` で行います。

## 設定

設定は MCP process の環境変数で渡します。

| Environment variable | Default | Meaning |
|---|---|---|
| `STRUCTURAL_MCP_FEMPYTHON_RUNNER` | `./FEMPython/FrameWebforCS/Headless/bin/Release/net10.0-windows/FrameWebforCS.Headless.exe` | FrameWebforCS protocol v1 runner（Windows / .NET 10 / Python環境が必要） |
| `STRUCTURAL_MCP_WEBDAN_RUNNER` | `./Capacita/WebDanforCS/Headless/bin/Release/net8.0/WebDanforCS.Headless.dll` | Capacita protocol v1 互換 runner DLL の絶対 path。変数名は後方互換のため維持 |
| `STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER` | `./SoilStructure/SoilStructure/Headless/bin/Release/net10.0/SoilStructure.Headless.exe` | SoilStructure protocol v1 runner の絶対 path |
| `STRUCTURAL_MCP_JOB_ROOT` | `%LOCALAPPDATA%/structural-mcp/jobs` | MCP 所有 job root |
| `STRUCTURAL_MCP_ALLOWED_ROOTS` | `%USERPROFILE%/Documents` | 読取可能な入力 root。複数指定は Windows で `;` 区切り |
| `STRUCTURAL_MCP_ENABLE_STEELDAN` | `false` | experimental な SteelDan を明示的に有効化 |
| `STRUCTURAL_MCP_TIMEOUT_MS` | `180000` | runner timeout |
| `STRUCTURAL_MCP_MAX_INPUT_BYTES` | `16777216` | 入力上限 |
| `STRUCTURAL_MCP_MAX_ARTIFACT_BYTES` | `134217728` | artifact 単体上限 |
| `STRUCTURAL_MCP_MAX_TEXT_READ_BYTES` | `262144` | text artifact の 1 回の読取上限 |

例は [`config/structural-mcp.example.json`](./config/structural-mcp.example.json) にあります。

## Codex への登録

runner と MCP server を build した後、互換 runner の実際の配置を指定して登録します。

```powershell
codex mcp add structural-mcp `
  --env STRUCTURAL_MCP_FEMPYTHON_RUNNER=C:\path\to\FEMPython\FrameWebforCS\Headless\bin\Release\net10.0-windows\FrameWebforCS.Headless.exe `
  --env STRUCTURAL_MCP_WEBDAN_RUNNER=C:\path\to\capacita-headless.dll `
  --env STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER=C:\path\to\SoilStructure.Headless.dll `
  --env STRUCTURAL_MCP_JOB_ROOT=C:\path\to\structural-mcp-jobs `
  --env STRUCTURAL_MCP_ALLOWED_ROOTS=C:\path\to\Documents `
  --env STRUCTURAL_MCP_ENABLE_STEELDAN=true `
  -- node C:\path\to\structural-mcp\dist\src\index.js
```

登録後に Codex を新しい session で開き、`get_capabilities` で状態を確認してください。

開発中はrelease用の `structural-mcp` と分けて `structural-mcp-dev` を登録し、build後に新しいCodex sessionから実際のtoolを呼びます。具体的な登録command、反復手順、MSI配布方針は[配布・開発中MCPテスト計画](./.agents/docs/plans/distribution-and-development-testing-plan.md)を参照してください。

## セキュリティ境界と既知の制約

- 入力 file は realpath 解決後に allowed root 内であることを確認します。
- AI から任意 command、cwd、出力 path を受け取る shell tool は提供しません。
- job ID と artifact path を検証し、job root 外の読取りを拒否します。
- runner の stdout・stderr、入力、artifact、timeout に上限があります。
- 現版の timeout 停止は直接の runner process が対象です。将来の孫 process までを Windows Job Object で強制終了する処理は未実装です。
- SteelDan は `experimental` です。構造計算結果は設計者による照査を代替しません。

## 関連文書

- [FEMPython](./FEMPython/README.md)
- [Capacita](./Capacita/README.md)
- [SoilStructure](./SoilStructure/README.md)
- [配布・開発中MCPテスト計画](./.agents/docs/plans/distribution-and-development-testing-plan.md)
- [統合 MCP server 実装プラン](./.agents/docs/plans/structural-mcp-server-plan.md)（旧名称を含む歴史的計画）
- [旧 WebDan2 headless 計画](./.agents/docs/plans/webdan2-headless-mcp-plan.md)（現在の Capacita）
- [旧 SoilDisp headless 計画](./.agents/docs/plans/soildisp-headless-mcp-plan.md)（現在の SoilStructure）
