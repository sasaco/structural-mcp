# structural-mcp

`FEMPython`、`Capacita`、`SoilStructure` の構造解析・照査機能を、Codex などの MCP client から利用するためのローカル STDIO MCP gateway です。各計算エンジンの式はこのリポジトリへ再実装せず、Git submodule として固定した各プロジェクトの非対話 entry point を呼び出します。

## 公開対象

| Submodule | MCP で扱う領域 | 主な成果物 | 現在の状態 |
|---|---|---|---|
| [`FEMPython`](./FEMPython/) | 骨組・有限要素解析 | 解析結果 JSON | submodule 追加済み、MCP adapter は未実装 |
| [`Capacita`](./Capacita/) | RC・鋼部材の断面照査 | 結果 JSON、PDF、Markdown、Excel | 既存 adapter あり。旧 runner path から submodule への移行中 |
| [`SoilStructure`](./SoilStructure/) | 地盤・杭の計算、SNAP連携、地盤応答変位 | 中間結果 JSON、PDF、SDC、JOT | MCP adapter 接続済み。headless runner を個別設定して利用 |

> [!NOTE]
> `WebDan2` は旧リポジトリ名です。現在の正式なリポジトリ名は `Capacita` で、RC 計算コアは `RcDan`、鋼部材計算コアは `SteelDan`、統合アプリケーションは `WebDanforCS` に整理されています。互換性維持のため、現行 MCP の tool ID と環境変数には `webdan` という旧名称が残っています。

## 現在の MCP interface

ルートの TypeScript server には、Capacita と SoilStructure の protocol v1 runner を接続できます。

| Tool | Purpose | Output |
|---|---|---|
| `get_capabilities` | engine の利用可否、readiness、制限を確認 | capability 一覧 |
| `get_environment_template` | AIが `.env` を作成するときのrunner設定名と推奨絶対パスを取得 | dotenv template、pathの読取可否 |
| `webdan_calculate` | Capacita の RC 断面照査を実行 | 要約、`result.json`、PDF または Markdown、任意 XLSX |
| `steeldan_calculate` | Capacita の鋼部材照査を実行 | 照査要約、`result.json`、任意 PDF |
| `soilstructure_calculate` | SoilStructure document JSON から杭計算を実行 | 計算要約、`result.json`、任意 PDF |
| `soilstructure_export_sdc` | 杭計算と `sdcExport` 設定からSNAP連携データを生成 | `result.json`、通常・液状化L1/L2 SDC |
| `soilstructure_ground_displacement` | `groundDisplacement` 設定からL1/L2地盤応答変位を計算 | `result.json`、任意 PDF、任意 L1/L2 JOT |
| `get_job` | 過去の job を取得 | manifest と artifact metadata |
| `read_text_artifact` | JSON・Markdown・text 成果物を範囲読取 | UTF-8 text fragment |

FEMPython はリポジトリへの組込みまで完了していますが、tool と runner の接続は今後の実装対象です。Capacita と SoilStructure の runner は独立して検出されるため、一方が未導入でも MCP server と他方の engine は利用できます。

計算 tool は PDF や巨大な結果を MCP 応答へ埋め込みません。短い summary と artifact metadata を返し、完全な結果は job directory へ保存します。`executionStatus` と `engineeringStatus` は別項目です。process が正常終了しても、照査結果が `not_ok` になることがあります。

## 構成

```text
Codex / MCP client
        |
        | MCP over STDIO
        v
structural-mcp (Node.js 24 / TypeScript)
        |
        +-- FEMPython adapter ------> FEMPython        （未実装）
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
```

現行の Capacita adapter は、protocol v1 互換の headless runner DLL を `STRUCTURAL_MCP_WEBDAN_RUNNER` で受け取ります。旧 `../WebDan2` を前提とした既定 path と integration test は、Capacita submodule の正式な runner 配置が確定するまでの互換層です。

SoilStructure adapter は `STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER` の runner に、次の非対話commandで接続します。

```text
run --input <file> --output-dir <empty-dir> --generate-pdf true|false
export-sdc --input <file> --output-dir <empty-dir>
run-ground-displacement --input <file> --output-dir <empty-dir> --generate-pdf true|false --generate-jot true|false
```

入力には allowed root 内の `.soilstructure.json` / `.json` path、または inline JSON を指定できます。`inputPath` と `input` は同時には指定できません。SDCはCP932・CRLFで通常版と、入力に液状化低減係数がある場合はL1/L2版を生成します。JOTもCP932・CRLFで、文書の `includeL1` / `includeL2` に従って最大2ファイルを生成します。

別プロジェクトからrunnerを直接呼ぶスクリプトの `.env` をAIに作成させる場合、AIは最初に `get_environment_template` を呼びます。応答には設定キー、現在の推奨絶対path、runnerが読み取り可能かどうか、およびそのまま保存できるdotenv形式の `content` が含まれます。MCPは既存の `.env` や秘密情報を読み取りません。

## 設定

設定は MCP process の環境変数で渡します。

| Environment variable | Default | Meaning |
|---|---|---|
| `STRUCTURAL_MCP_WEBDAN_RUNNER` | 旧 `../WebDan2/.../WebDan2.Headless.dll` | Capacita protocol v1 互換 runner DLL の絶対 path。変数名は後方互換のため維持 |
| `STRUCTURAL_MCP_SOILSTRUCTURE_RUNNER` | `./SoilStructure/SoilStructure.Headless/bin/Release/net10.0/SoilStructure.Headless.exe` | SoilStructure protocol v1 runner の絶対 path |
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
