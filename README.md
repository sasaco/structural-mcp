# structural-mcp

`WebDan2`と`SteelDan`をCodexなどのAIから利用するためのローカルSTDIO MCPサーバーです。解析式は再実装せず、`../WebDan2`の.NET計算コアを1 tool callごとのheadless processとして実行します。

> [!IMPORTANT]
> 2026-09-21現在、WebDan2とSteelDanの第一段階を実装済みです。SteelDanは実運用oracleによる数値完全一致が未認定のため、`experimental`かつ既定無効です。

## 実装済みツール

| Tool | Purpose | Output |
|---|---|---|
| `get_capabilities` | engineの利用可否、readiness、制限を確認 | capability一覧 |
| `webdan_calculate` | `.wdj`をWebDan2で照査 | 要約、`result.json`、PDFまたはMarkdown、任意XLSX |
| `steeldan_calculate` | `.wsj`をSteelDanで照査 | 照査要約、`result.json`、任意PDF |
| `get_job` | 過去のjobを取得 | manifestとartifact metadata |
| `read_text_artifact` | JSON/Markdown/text成果物を範囲読取 | UTF-8 text fragment |

計算ツールはPDFや巨大な結果をMCP応答へ埋め込みません。短いsummaryとartifact metadataを返し、完全な結果はjob directoryへ保存します。`executionStatus`と`engineeringStatus`は別項目です。プロセスが正常終了しても、照査結果が`not_ok`になることがあります。

## 構成

```text
Codex / MCP client
        |
        | MCP over STDIO
        v
structural-mcp (Node.js 24 / TypeScript)
        |
        | child process per call
        v
WebDan2.Headless (.NET 8)
        +-- run-rc    --> WebDan2.WebDan2.Main()
        `-- run-steel --> SteelDan.SteelDan.Main()
```

runnerのstdoutはprotocol v1 JSON 1件だけです。成果物には相対path、byte size、SHA-256を付与し、MCP側でもjob directory内にあることとhashを再検証します。

## 必要環境

- Node.js 24以上
- .NET SDK 8以上
- 同じ親directoryに`structural-mcp`と`WebDan2`を配置

## buildとtest

```powershell
dotnet build ..\WebDan2\WebDan2.Headless\WebDan2.Headless.csproj -c Release
npm ci
npm run build
npm test
```

`npm test`はMCP SDKの`StdioClientTransport`で実サーバーを起動し、次を確認します。

- 5 toolsの列挙
- 実`.wdj`によるWebDan2 Markdown生成とtext artifact読取
- 実`.wsj`によるSteelDan result JSON/PDF生成
- allowed root外の入力path拒否

人間が結果を確認するsmoke出力も実行できます。

```powershell
npm run smoke
```

## 設定

設定はMCP processの環境変数で渡します。

| Environment variable | Default | Meaning |
|---|---|---|
| `STRUCTURAL_MCP_WEBDAN_RUNNER` | `../WebDan2/WebDan2.Headless/bin/Release/net8.0/WebDan2.Headless.dll` | runner DLLの絶対path |
| `STRUCTURAL_MCP_JOB_ROOT` | `%LOCALAPPDATA%/structural-mcp/jobs` | MCP所有job root |
| `STRUCTURAL_MCP_ALLOWED_ROOTS` | `%USERPROFILE%/Documents` | 読取可能な入力root。複数指定はWindowsで`;`区切り |
| `STRUCTURAL_MCP_ENABLE_STEELDAN` | `false` | experimental SteelDanを明示的に有効化 |
| `STRUCTURAL_MCP_TIMEOUT_MS` | `180000` | runner timeout |
| `STRUCTURAL_MCP_MAX_INPUT_BYTES` | `16777216` | 入力上限 |
| `STRUCTURAL_MCP_MAX_ARTIFACT_BYTES` | `134217728` | artifact単体上限 |
| `STRUCTURAL_MCP_MAX_TEXT_READ_BYTES` | `262144` | text artifactの1回の読取上限 |

例は[`config/structural-mcp.example.json`](./config/structural-mcp.example.json)にもあります。

## Codexへの登録

先にrunnerとMCPをbuildしてから登録します。

```powershell
codex mcp add structural-mcp `
  --env STRUCTURAL_MCP_WEBDAN_RUNNER=C:\path\to\WebDan2.Headless.dll `
  --env STRUCTURAL_MCP_JOB_ROOT=C:\path\to\structural-mcp-jobs `
  --env STRUCTURAL_MCP_ALLOWED_ROOTS=C:\path\to\Documents `
  --env STRUCTURAL_MCP_ENABLE_STEELDAN=true `
  -- node C:\path\to\structural-mcp\dist\src\index.js
```

登録後にCodexを新しいsessionで開き、`get_capabilities`で状態を確認してください。

## セキュリティ境界と既知の制約

- 入力fileはrealpath解決後にallowed root内であることを確認します。
- AIから任意command、cwd、出力pathを受け取るshell toolは提供しません。
- job IDとartifact pathを検証し、job root外の読取りを拒否します。
- runnerのstdout/stderr、入力、artifact、timeoutに上限があります。
- 現版のtimeout停止は直接のrunner processが対象です。Windows Job Objectによる将来の孫processまでの強制終了は未実装です。
- SteelDanは`experimental`です。構造計算結果は設計者による照査を代替しません。

## 関連文書

- [統合MCPサーバー実装プラン](./.agents/docs/plans/structural-mcp-server-plan.md)
- [WebDan2 headless化・MCP連携準備プラン](./.agents/docs/plans/webdan2-headless-mcp-plan.md)
