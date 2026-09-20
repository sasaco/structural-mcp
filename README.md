# structural-mcp

`FrameWeb3`、`WebDan2`、`SoilDisp`を、CodexなどのAIからMCP経由で安全に利用するためのローカル統合サーバーです。

> [!IMPORTANT]
> 2026-09-20現在、このリポジトリは設計・計画段階です。MCPサーバー本体、公開ツール、インストールコマンドはまだ実装されていません。実装順と完了条件は[統合MCPサーバー実装プラン](./.agents/docs/plans/structural-mcp-server-plan.md)を参照してください。

## 目的

構造設計で使用する複数の解析プログラムには、それぞれ異なるUI、入力形式、ランタイムがあります。本プロジェクトは解析ロジックを再実装せず、各プログラムが提供するheadless runnerをMCPツールとして統一します。

```text
Codex / MCP client
        |
        | MCP over STDIO
        v
structural-mcp
        |
        +-- FrameWeb adapter --> FrameWeb3 headless runner
        |
        +-- WebDan adapter ---> WebDan2 headless runner
        |
        `-- SoilDisp adapter -> SoilStructure.Headless
```

MCPサーバーはCodexのセッション中に動作します。解析エンジンは必要なtool callごとに子プロセスとして起動し、計算終了後に終了します。

## 責務の分担

| Repository | Responsibility |
|---|---|
| `structural-mcp` | MCP tools、入力検証、子プロセス管理、timeout/cancel、job/artifact管理、共通エラー形式 |
| `../FrameWeb3` | FEM解析、`AnalysisResultSet`、FrameWeb帳票生成 |
| `../WebDan2` | `.wdj`のRC断面照査、PDF/Markdown帳票生成 |
| `../SoilDisp` | 杭・地盤計算、構造化結果、PDF帳票生成 |

このリポジトリへ解析式、係数、帳票ロジックをコピーしません。計算結果の正本は各解析リポジトリに残します。

## 予定するMCPツール

| Tool | Purpose | Planned output |
|---|---|---|
| `get_capabilities` | 各engineの利用可否、version、対応形式を確認 | capability一覧 |
| `frameweb_analyze` | FrameWeb3で骨組解析を実行 | 計算要約、`analysis-result.json` |
| `webdan_calculate` | WebDan2で`.wdj`を照査 | message要約、PDFまたはMarkdown |
| `soildisp_calculate` | SoilDispで杭・地盤計算を実行 | 計算要約、`result.json`、任意PDF |
| `get_job` | 過去の実行状態と成果物を取得 | job manifest |
| `read_text_artifact` | job内のJSON/Markdown/textを範囲読取 | text fragment |

計算ツールは巨大な計算結果やPDFをMCP応答へ直接埋め込みません。短いsummaryとartifact metadataを返し、完全な結果はjob directoryへ保存します。

## headless runner

本プロジェクトはWinFormsやWeb UIを非表示で操作しません。各解析リポジトリに、次の契約を満たす非対話runnerを用意します。

- JSONまたは既存保存ファイルを入力する。
- GUI、確認ダイアログ、疑似クリックを使用しない。
- stdoutにはUTF-8 JSON objectを1件だけ出力する。
- 診断ログはstderrへ出力する。
- 結果JSON、PDF、Markdownなどは指定job directoryへ保存する。
- 成功、入力不正、検証失敗、計算失敗、I/O失敗を区別する。
- protocol versionとengine versionを返す。

SoilDispのheadless化は、[SoilDisp改修プラン](./.agents/docs/plans/soildisp-headless-mcp-plan.md)で個別に定義しています。

## 予定技術スタック

- Node.js 24
- TypeScript / ESM / strict mode
- npm / `package-lock.json`
- `@modelcontextprotocol/sdk`
- Zod
- Vitest
- STDIO transport

実行時はNode標準の`child_process.spawn()`を`shell: false`で使用します。AIから任意のcommand、cwd、output pathを受け取る汎用shell toolは提供しません。

## 予定ディレクトリ構成

```text
structural-mcp/
|- src/
|  |- server/       # MCP serverとinstructions
|  |- tools/        # 公開MCP tools
|  |- adapters/     # FrameWeb3/WebDan2/SoilDisp adapters
|  |- process/      # timeout/cancel/process tree管理
|  |- jobs/         # job manifestとartifacts
|  |- paths/        # allowed rootsとpath検証
|  `- contracts/    # 共通結果・エラー型
|- schemas/         # runner/tool JSON Schema
|- tests/
|  |- unit/
|  |- contract/
|  |- integration/
|  `- protocol/
|- config/
|  `- structural-mcp.example.json
|- scripts/
`- .agents/docs/plans/
```

## jobと成果物

各計算は一意のjob IDを持ちます。

```text
<jobRoot>/<date>/<jobId>/
|- manifest.json
|- input/
|- work/
|- output/
|  |- result.json
|  `- report.pdf
`- logs/
```

- user指定の任意output pathへ書き込みません。
- artifactは所有するjob directory配下だけを受理します。
- sizeとSHA-256をMCP側で再検証します。
- 初期版ではjobを自動削除しません。

## セキュリティ境界

初期版は、単一ユーザー・同一Windows PC・信頼済みCodex host向けです。

それでも以下を必須とします。

- tool input、file path、runner responseをuntrustedとして検証する。
- 入力ファイルは設定されたallowed root内だけを許可する。
- symlink/junction、path traversal、job外artifactを拒否する。
- engine commandと引数はadapter内で固定する。
- timeout、同時実行数、stdout/stderr/input/artifact sizeを制限する。
- token、環境変数値、入力モデル全文をログへ記録しない。
- timeout/cancel時は、そのtool callが起動したprocess treeだけを終了する。

Streamable HTTPや外部公開へ移行する場合は、OAuth、TLS、tenant分離、rate limit、remote artifact storageを別設計します。

## 開発ロードマップ

1. 共通runner契約とfixtureの固定
2. TypeScript MCP projectの初期化
3. config、safe path、job/artifact基盤
4. bounded child process runner
5. MCP serverと共通tools
6. FrameWeb3 adapter
7. WebDan2 adapter
8. SoilDisp adapter
9. Codex登録とend-to-end test
10. 運用・セキュリティドキュメント

詳細なgate、テストmatrix、rollout、rollback、Definition of Doneは[統合MCPサーバー実装プラン](./.agents/docs/plans/structural-mcp-server-plan.md)に記載しています。

## 実装後の想定コマンド

以下は計画中のインターフェースであり、現時点ではまだ実行できません。

```powershell
npm ci
npm run build
npm test
```

Codexへの登録例:

```powershell
codex mcp add structural-mcp `
  --env STRUCTURAL_MCP_CONFIG=C:\path\to\structural-mcp.local.json `
  -- node C:\path\to\structural-mcp\dist\index.js
```

## 検証方針

- unit: schema、config、path、job、artifact、error mapping
- contract: fake runnerの成功、hang、不正JSON、巨大出力、artifact違反
- integration: 3解析engineの代表fixture
- protocol: MCP initialize、tools/list、tool call、cancel、output schema
- end-to-end: Codexから解析を実行し、job/artifactまで検証

構造計算結果は設計者による照査を代替しません。ツールの成功は、入力条件、適用基準、モデル化、工学的妥当性の保証を意味しません。

## ドキュメント

- [structural-mcp 統合MCPサーバー実装プラン](./.agents/docs/plans/structural-mcp-server-plan.md)
- [SoilDisp headless化・MCP連携準備 改修プラン](./.agents/docs/plans/soildisp-headless-mcp-plan.md)
- [OpenAI: Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?translationFallback=ja-JP)
- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)

