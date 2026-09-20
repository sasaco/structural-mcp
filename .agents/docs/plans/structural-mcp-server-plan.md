# structural-mcp 統合MCPサーバー実装プラン

- 状態: Proposed
- 作成日: 2026-09-20
- 対象リポジトリ: `structural-mcp`
- 連携対象: `../FrameWeb3`、`../WebDan2`、`../SoilDisp`
- 初期トランスポート: STDIO
- 実装言語: TypeScript / Node.js 24

## 1. 目的

`FrameWeb3`、`WebDan2`、`SoilDisp`の構造解析・照査機能を、CodexなどのMCPクライアントから安全かつ再現可能に利用できる単一のMCPサーバーを構築する。

このrepoは解析式や帳票ロジックの正本を持たない。各解析repoが提供する非対話headless runnerを、入力検証、プロセス隔離、ジョブ管理、成果物管理、エラー正規化を備えたMCPツールとして公開する。

初期利用者は同一PC上のCodexとし、MCPサーバーはCodexが起動するローカルSTDIOプロセスとする。常駐HTTPサービス、外部公開、OAuth、プラグイン公開は初期スコープに含めない。

## 2. 設計上の決定

### 2.1 このrepoの責務

- MCPサーバーの初期化、server instructions、ツール登録。
- AIから受け取る入力のスキーマ検証。
- 各解析runnerの存在、バージョン、実行可能性の診断。
- 引数配列を使った安全な子プロセス起動。
- タイムアウト、キャンセル、同時実行数、stdout/stderr上限の管理。
- ジョブ専用ディレクトリと成果物manifestの管理。
- 各runner固有の結果・例外を共通MCP結果へ変換。
- 計算要約、警告、成果物識別子を`structuredContent`として返す。
- 単体、契約、統合、MCPプロトコルの自動テスト。
- Codexへのローカル登録手順と運用ドキュメント。

### 2.2 このrepoが担当しないもの

- 有限要素法、断面照査、杭・地盤計算などの工学ロジック。
- PDF、Markdown、Excel生成の中身。
- WinFormsやAngularの自動操作。
- 各解析repoの入力ファイル形式の独自再実装。
- 各解析repoのDLLをこのrepoへコピーして管理すること。
- 任意のシェルコマンドを実行する汎用ツール。
- 任意のファイルパスへ成果物を書き込む機能。
- 初期版でのStreamable HTTP、リモート配備、マルチユーザー認証。

### 2.3 プロセス境界

MCPサーバーはセッション中動作するが、解析エンジンはツール呼出ごとに子プロセスとして起動する。

```text
Codex / MCP client
        |
        | MCP over STDIO
        v
structural-mcp (Node.js)
        |
        +-- FrameWeb adapter -- child process --> FrameWeb3 headless runner
        |
        +-- WebDan adapter --- child process --> WebDan2 headless runner
        |
        `-- SoilDisp adapter - child process --> SoilStructure.Headless
```

理由:

- Python、.NET 8、.NET 10の異種ランタイムを同一プロセスへ混在させない。
- `WebDan2`のstatic service状態を呼出間で共有しない。
- 解析失敗、メモリリーク、異常終了をMCPサーバー本体から隔離する。
- runnerごとにversion、timeout、同時実行数を固定できる。
- GUIを非表示起動する不安定な経路を排除できる。

## 3. 現状と外部依存

### 3.1 FrameWeb3

- Python計算コアは`FrameWeb/src/fem/analysis_result_sets.py`の`build_analysis_result_set()`から`AnalysisResultSet`を生成できる。
- Python環境は`uv`と`FrameWeb/uv.lock`で固定されている。
- C#側には`IAnalysisClient`、`FrameWebAnalysisClient`、UI非依存のprinting層がある。
- 既存`PDF_Test_CLI`は`Console.ReadLine()`を使う対話型CLIであり、MCP runnerには利用しない。
- bare `python`はこのPCのPATHにない。必ず`uv --directory <FrameWeb> run --locked ...`を使う。

外部前提:

- `FrameWeb3`側に、JSON入力から`AnalysisResultSet`を生成し、JSON envelope 1件をstdoutへ返す非対話runnerを用意する。
- PDF生成を初期ツールへ含める場合は、C# printing coreを呼ぶ別runnerを用意し、解析runnerと責務を分ける。

### 3.2 WebDan2

- `WebDan2/WebDan2.cs`の`WebDan2.Main()`は`.wdj`内容を受け取り、PDFまたはMarkdown、messageを返す。
- ターゲットは`net8.0`。
- `OutputFormat`は`Pdf`と`Markdown`。
- 内部でstaticな`ErrorMessageService`やlanguage stateを利用するため、1呼出1プロセスを原則とする。
- `SteelDan`は同repo内の別計算コアだが、初期MVPには含めない。別ツール追加時に独立した計画とfixtureを用意する。

外部前提:

- `WebDan2`側に、`.wdj`入力、output format、成果物ディレクトリを受け取る非対話JSON CLIを用意する。
- runnerはPDF/Markdownをstdoutへ埋め込まず、成果物ファイルと小さいJSON envelopeを返す。

### 3.3 SoilDisp

- `SoilPile`は`net10.0`のUI非依存ライブラリ。
- `PileCalculator.Calculate(ReportRequest)`と`PileReportRenderer.Render(ReportResult)`が存在する。
- 現在の起動アプリ`SoilStructure`は`net10.0-windows` WinForms。
- headless化の詳細は[SoilDisp headless化・MCP連携準備 改修プラン](./soildisp-headless-mcp-plan.md)を正本とする。

外部前提:

- `SoilStructure.Headless`が入力JSON、結果JSON、任意PDF、終了コード、stdout envelope契約を提供する。

### 3.4 外部runner共通契約

各runnerは内部実装が異なっても、次を満たす。

- 非対話実行であり、stdin待ち、確認ダイアログ、GUI表示を行わない。
- 引数は`--input`、`--output-dir`、必要なenum optionだけとする。
- stdoutはUTF-8のJSONオブジェクト1件だけ。
- 診断ログはstderr。
- 成果物は指定された空のjob directory配下だけへ書く。
- 成功はexit code 0。入力、検証、計算、I/Oを終了コードまたはerror categoryで区別する。
- 応答に`protocolVersion`、`engineVersion`、`ok`、`summary`、`messages`、`artifacts`、`errors`を含める。
- artifactにはrelative path、media type、byte size、SHA-256を含める。
- stdout/stderrへ秘密情報、巨大な解析結果、PDF Base64を出さない。

## 4. 技術スタック

### 4.1 ランタイム

- Node.js 24。開発PCで`v24.13.0`を確認済み。
- TypeScript、ESM、strict mode。
- npmと`package-lock.json`で依存を固定する。
- MCP SDKは公式`@modelcontextprotocol/sdk`。
- schemaは`zod`。
- テストは`vitest`。
- lint/formatはESLintとPrettier。依存versionは導入時の承認版をexact lockする。

公式OpenAIドキュメントはTypeScript SDKとPython SDKを公式選択肢として示している。本計画ではWindows上の異種子プロセス制御、JSON処理、MCP schema定義を1つのruntimeで扱うためTypeScriptを選択する。

### 4.2 package方針

runtime dependenciesを最小化する。

```text
dependencies
  @modelcontextprotocol/sdk
  zod

devDependencies
  @types/node
  eslint
  prettier
  tsx
  typescript
  vitest
```

子プロセス、ハッシュ、ファイル操作、UUID、AbortSignalはNode標準APIを優先し、shell wrapperや汎用command実行packageを導入しない。

## 5. 目標ディレクトリ構成

```text
structural-mcp/
|- package.json
|- package-lock.json
|- tsconfig.json
|- eslint.config.js
|- .prettierrc.json
|- .gitignore
|- README.md
|- config/
|  `- structural-mcp.example.json
|- schemas/
|  |- common/
|  |- frameweb3/
|  |- webdan2/
|  `- soildisp/
|- src/
|  |- index.ts
|  |- server/
|  |  |- create-server.ts
|  |  `- instructions.ts
|  |- config/
|  |  |- load-config.ts
|  |  `- config-schema.ts
|  |- tools/
|  |  |- register-tools.ts
|  |  |- capabilities.ts
|  |  |- frameweb-analyze.ts
|  |  |- webdan-calculate.ts
|  |  |- soildisp-calculate.ts
|  |  |- get-job.ts
|  |  `- read-text-artifact.ts
|  |- adapters/
|  |  |- engine-adapter.ts
|  |  |- frameweb3-adapter.ts
|  |  |- webdan2-adapter.ts
|  |  `- soildisp-adapter.ts
|  |- process/
|  |  |- process-runner.ts
|  |  |- process-errors.ts
|  |  `- process-tree.ts
|  |- jobs/
|  |  |- job-store.ts
|  |  |- job-manifest.ts
|  |  `- artifact-store.ts
|  |- paths/
|  |  `- safe-path.ts
|  |- concurrency/
|  |  `- semaphore.ts
|  `- contracts/
|     |- common.ts
|     |- errors.ts
|     `- artifacts.ts
|- tests/
|  |- unit/
|  |- contract/
|  |- integration/
|  |- protocol/
|  `- fixtures/
|- scripts/
|  |- install-local.ps1
|  |- smoke-test.ps1
|  `- clean-owned-jobs.ps1
`- .agents/docs/
```

`schemas/`は人間・外部runnerとの契約確認用JSON Schemaを置く。MCPツール実行時の正本はTypeScript/Zod schemaとし、JSON Schemaは同じ定義から生成するか、contract testで差分を検出する。手作業で二重管理しない。

## 6. 設定契約

実行ファイルの絶対パスや個人ディレクトリをgitへcommitしない。commitするのはexample configだけとする。

設定例:

```json
{
  "schemaVersion": 1,
  "jobRoot": "C:/Users/example/AppData/Local/structural-mcp/jobs",
  "allowedInputRoots": [
    "C:/Users/example/Documents"
  ],
  "engines": {
    "frameweb3": {
      "enabled": true,
      "repositoryRoot": "C:/Users/example/Documents/FrameWeb3",
      "timeoutMs": 120000,
      "maxConcurrency": 1,
      "maxStdoutBytes": 1048576,
      "maxStderrBytes": 4194304
    },
    "webdan2": {
      "enabled": true,
      "repositoryRoot": "C:/Users/example/Documents/WebDan2",
      "timeoutMs": 180000,
      "maxConcurrency": 1,
      "maxStdoutBytes": 1048576,
      "maxStderrBytes": 4194304
    },
    "soildisp": {
      "enabled": true,
      "repositoryRoot": "C:/Users/example/Documents/SoilDisp",
      "timeoutMs": 180000,
      "maxConcurrency": 1,
      "maxStdoutBytes": 1048576,
      "maxStderrBytes": 4194304
    }
  }
}
```

設定探索順:

1. `STRUCTURAL_MCP_CONFIG`環境変数で指定されたファイル。
2. repo直下の`config/structural-mcp.local.json`。
3. exampleから導出せず、設定不足として起動エラーにする。

commandや任意argsを設定値として受け取らない。各adapterが`repositoryRoot`から既知のrunner pathと固定引数を構築する。これにより設定ファイルを任意command実行面にしない。

サーバーは設定全体が不正なら起動を拒否する。個別engineが未build、未導入、version不一致の場合はサーバー自体を起動し、`get_capabilities`で`unavailable`理由を返す。該当ツール呼出は`engine_unavailable`で失敗させる。

## 7. MCP server契約

### 7.1 server identityとinstructions

- server name: `structural-mcp`
- semantic versionを`package.json`と一致させる。
- STDIO transportを使用する。
- stdoutへMCPプロトコル以外を一切出さない。
- server logと子プロセス診断はstderrへ出す。

instructions先頭512文字以内に次を含める。

- 構造計算結果は専門家の照査を代替しない。
- 単位付き入力を厳密に扱う。
- 計算ツールはjob artifactsを作成する。
- 計算後はsummary、warning、error、artifactを確認する。
- engineが利用不能なら`get_capabilities`を呼ぶ。

### 7.2 公開ツール

#### `get_capabilities`

目的:

- 3 engineの有効/無効、runner存在、version、対応出力形式を確認する。

annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: false`

#### `frameweb_analyze`

目的:

- FrameWeb3へモデルJSONを渡し、`AnalysisResultSet`を生成する。

入力:

- `source`: inline JSONまたは許可root内のJSON file。
- `includeReport`: MVPでは`false`固定。report runner完成後に後方互換なoptional fieldとして有効化する。

出力:

- case数、解析種別、node/member数、単位、warning要約。
- 完全な`analysis-result.json` artifact。
- report対応後はPDF artifact。

#### `webdan_calculate`

目的:

- `.wdj`入力をWebDan2で照査し、PDFまたはMarkdownを生成する。

入力:

- `source`: inline `.wdj`文字列または許可root内の`.wdj` file。
- `outputFormat`: `pdf | markdown`。

出力:

- return code、message level別件数、主要message要約。
- `report.pdf`または`report.md` artifact。
- runnerが完全結果を出せる場合は`result.json` artifact。

#### `soildisp_calculate`

目的:

- 杭・地層条件をSoilDispで計算し、構造化結果と任意PDFを生成する。

入力:

- `source`: inline `PileAnalysisInput` JSONまたは許可root内のJSON file。
- `generatePdf`: boolean、default false。

出力:

- 杭種、地層数、主要支持力・抵抗・判定の要約。
- `result.json` artifact。
- `generatePdf=true`時は`report.pdf` artifact。

#### `get_job`

目的:

- 過去のtool応答を巨大な再実行なしで参照する。

入力:

- `jobId`。

出力:

- engine、tool、開始/終了日時、状態、summary、messages、artifact metadata。

annotationsはread-onlyとする。

#### `read_text_artifact`

目的:

- jobに属するMarkdown/JSON/text artifactの一部を安全に読む。

入力:

- `jobId`、`artifactId`、`offset`、`maxBytes`。

制約:

- text系media typeだけ。
- 1回の最大読取量を設定で制限する。
- PDFやbinaryは内容を返さずpathとmetadataだけ返す。

annotationsはread-onlyとする。

### 7.3 計算ツール共通annotations

計算ツールはjob artifactsを作成するため、MCP上のread-onlyとは宣言しない。

- `readOnlyHint: false`
- `destructiveHint: false`
- `openWorldHint: false`

## 8. 共通結果契約

計算成功時の`structuredContent`:

```json
{
  "ok": true,
  "jobId": "018f...",
  "engine": "soildisp",
  "engineVersion": "1.0.0",
  "summary": {},
  "messages": [
    {
      "level": "warning",
      "code": "...",
      "text": "..."
    }
  ],
  "artifacts": [
    {
      "artifactId": "result",
      "name": "result.json",
      "mediaType": "application/json",
      "bytes": 12345,
      "sha256": "...",
      "path": "C:/.../jobs/.../result.json"
    }
  ]
}
```

失敗時:

```json
{
  "ok": false,
  "jobId": "018f...",
  "engine": "webdan2",
  "category": "validation",
  "errors": [
    {
      "code": "invalid_input",
      "path": "source",
      "message": "入力ファイルを読み込めません。"
    }
  ]
}
```

共通category:

- `invalid_request`: MCP入力schema不正。
- `input_access`: pathが許可root外、未存在、size超過。
- `engine_unavailable`: runner未build、runtime不足、version不一致。
- `validation`: engineが工学入力を拒否。
- `calculation`: 計算不能、収束失敗、内部照査失敗。
- `timeout`: deadline超過。
- `cancelled`: MCP側cancelまたはserver shutdown。
- `protocol`: runner stdout、artifact manifest、versionが契約違反。
- `io`: job/artifact書込失敗。
- `internal`: 上記以外。

MCPのtext `content`には人間向けの短い要約だけを置く。完全JSON、child stdout/stderr、stack traceをモデルへ返さない。

## 9. ジョブと成果物

### 9.1 ディレクトリ

```text
<jobRoot>/
  2026-09-20/
    <jobId>/
      .structural-mcp-job
      manifest.json
      input/
        request.json
      work/
      output/
        result.json
        report.pdf
      logs/
        runner.stderr.log
```

rules:

- `jobId`はUUIDとし、外部入力からpathを組み立てない。
- job作成時にownership markerを置く。
- runnerにはjobの`work`/`output`だけを書込先として渡す。
- manifestは一時ファイルへ書いてatomic renameする。
- artifact pathは`output`配下のregular fileだけを受理する。
- symlink/junction、親参照、absolute artifact pathを拒否する。
- artifactを登録する前にsizeとSHA-256を再計算する。
- runnerが申告したhashだけを信用しない。

### 9.2 retention

MVPでは自動削除を行わない。`clean-owned-jobs.ps1`がownership marker、resolved path、job root containmentを検証したうえで、指定日数より古いjobだけを削除する。

自動retentionは運用容量を実測した後の追加機能とし、初期版で暗黙の削除をしない。

## 10. 安全なプロセス実行

`ProcessRunner`は次を保証する。

- `child_process.spawn(executable, args, { shell: false, windowsHide: true })`を使用する。
- executableと固定argsはadapter内で構築し、tool入力をcommand line断片にしない。
- input contentはcommand lineへ埋めず、job input fileへ書く。
- childのcwdをengine repoまたはjob work directoryへ固定する。
- allow-listed environmentだけを渡し、不要なtokenやsecretを継承しない。
- stdout/stderrを別々にcaptureし、byte limit超過でchildを停止する。
- timeoutとAbortSignalを統合する。
- Windowsでは、自分が生成し追跡しているPIDだけを対象にprocess treeを終了する。
- kill前後でPID、開始時刻、親子関係を確認し、無関係な同名プロセスを停止しない。
- exit後にstdout JSONをstrict parseし、余分なtextがあればprotocol errorにする。
- server shutdown時にactive childをcancelし、完了をbounded waitする。

同時実行:

- engineごとのsemaphore、初期値1。
- global上限2。
- queue待ちにもdeadlineを適用する。
- WebDan2は必ずprocess isolationを維持する。

## 11. path・入力安全性

inline入力:

- engineごとに最大byte数を設定する。
- UTF-8として検証する。
- JSONはparse後にschema検証する。
- `.wdj`はrunnerへ渡す前にサイズと文字コードを検証する。

file入力:

- `allowedInputRoots`配下だけ。
- `Path.resolve`の文字列比較だけでなく、既存fileの`realpath`を取得してroot containmentを判定する。
- regular fileのみ。directory、device、symlink/junction経由を拒否する。
- 拡張子は補助検査であり、内容schemaを正本とする。
- 読込前後でsizeを確認し、上限超過と途中差替えを検出する。

成果物:

- user指定output pathを受け取らない。
- job output外のrunner申告pathを拒否する。
- binary内容をMCP textへ埋め込まない。

## 12. 観測性

stderrのserver logはJSON Linesとする。

共通field:

- timestamp
- level
- event
- requestId
- jobId
- tool
- engine
- durationMs
- exitCode
- category

禁止事項:

- 入力モデル全文。
- `.wdj`全文。
- access token、環境変数値。
- child stack traceを通常のMCP応答へ含めること。

child stderrはjob logへ保存するが、MCP応答へは末尾のsanitized summaryだけを必要時に含める。ログ上限を超えた場合はtruncated flagをmanifestへ残す。

## 13. 実装手順

### Step 0: 契約とfixtureを固定する

作業:

1. 3 engineのrunner契約version、入力上限、timeout、artifact種別を表にする。
2. 各engineの成功fixtureを最低1件、失敗fixtureを最低2件用意する。
3. sibling repoのfixtureを正本とし、このrepoには小さいコピーまたはhash付きtest fixtureだけを置く。
4. runnerが未実装のengineにはfake runnerを用意し、MCP側開発を阻害しない。
5. `schemas/common/runner-envelope.schema.json`を確定する。

gate:

- fixtureの出典、license、期待結果が記録されている。
- secrets、顧客名、個人情報をfixtureに含まない。
- runner契約の未確定項目がissue/planへ明記されている。

### Step 1: TypeScript projectを初期化する

作業:

1. Node 24、ESM、TypeScript strictの`package.json`/`tsconfig.json`を作る。
2. MCP SDK、Zod、test/lint/format依存をexact lockする。
3. `npm run build`、`test`、`lint`、`format:check`を定義する。
4. stdout汚染を検出する最小STDIO server testを追加する。
5. `.gitignore`へ`node_modules`、`dist`、local config、jobs、test outputを追加する。

gate:

- `npm ci`後にbuild/test/lint/formatが成功する。
- `node dist/index.js`がSTDIO initializeに応答する。
- 通常起動でstdoutへログを出さない。

### Step 2: config、path、job基盤を実装する

作業:

1. strict config schemaと探索順を実装する。
2. allowed input root、job rootのcanonicalizationを実装する。
3. `JobStore`、ownership marker、atomic manifestを実装する。
4. artifact containment、size、hash再検証を実装する。
5. `get_job`と`read_text_artifact`を先に完成させる。

gate:

- traversal、別drive、case差、UNC、symlink/junctionのWindows testがある。
- 同じjobIdの二重作成を拒否する。
- job root外を読まない、書かない、削除しない。

### Step 3: ProcessRunnerを実装する

作業:

1. shell:falseのspawn、capture、limit、timeout、cancelを実装する。
2. 子プロセスtree終了をWindowsで検証する。
3. strict stdout envelope parseを実装する。
4. fake runnerで成功、非0終了、hang、巨大stdout、巨大stderr、不正JSON、途中artifactをテストする。
5. engine semaphoreとglobal semaphoreを実装する。

gate:

- timeout後にfake child/grandchildが残らない。
- stdout/stderr limitでMCP serverが落ちない。
- childが異常終了しても次のtool callを処理できる。

### Step 4: serverと共通toolを実装する

作業:

1. server identity、instructions、STDIO transportを実装する。
2. `get_capabilities`を実装する。
3. tool schema、output schema、annotationsを登録する。
4. 共通error mappingと短いtext contentを実装する。
5. tool callからjob manifestまでrequestId/jobIdを引き回す。

gate:

- MCP Inspectorまたはprotocol testでinitialize、tools/list、全schemaを確認する。
- tool metadataだけで利用条件、単位、成果物副作用が判断できる。
- 不正入力がrunner起動前に拒否される。

### Step 5: FrameWeb3 adapterを実装する

前提:

- FrameWeb3 headless analysis runnerが共通契約を満たす。

作業:

1. `uv`、repo root、lockfile、runner moduleをhealth checkする。
2. inline/file inputをjob input JSONへ正規化する。
3. `uv --directory ... run --locked ...`を固定argsで起動する。
4. `AnalysisResultSet`のsummaryとartifactを検証する。
5. static、material nonlinear、modalの代表fixtureを順次追加する。

gate:

- GUI、Angular、local HTTP serverなしで解析できる。
- 解析結果artifactがFrameWeb3契約schemaに一致する。
- 不正topology、work budget超過、solver失敗をcategoryへ写せる。

### Step 6: WebDan2 adapterを実装する

前提:

- WebDan2 headless runnerが共通契約を満たす。

作業:

1. .NET 8 runtime、runner DLL、engine versionをhealth checkする。
2. `.wdj` inline/file入力をjob inputへ保存する。
3. PDF/Markdown enumを固定引数で渡す。
4. ReturnCodeとMessage levelを共通summary/messagesへ変換する。
5. PDF/Markdown artifactを再hashし登録する。

gate:

- 同一fixtureの連続2回実行でstate leakageがない。
- 2呼出を同時要求してもengine semaphoreで安全に直列化される。
- error/fatal messageを成功扱いしない。

### Step 7: SoilDisp adapterを実装する

前提:

- [SoilDisp headless化計画](./soildisp-headless-mcp-plan.md)のDoDを満たす。

作業:

1. .NET 10 runtime、runner DLL、protocol versionをhealth checkする。
2. `PileAnalysisInput`をjob inputへ保存する。
3. `generatePdf`を固定optionへ変換する。
4. calculation summary、field error、result/PDF artifactを変換する。
5. 場所打ち杭、鋼管ソイルセメント杭、回転杭fixtureを統合テストする。

gate:

- `MainForm`プロセスが起動しない。
- 3杭種でresult JSONを取得できる。
- PDF requested時だけPDF artifactを作る。

### Step 8: Codex登録とend-to-end testを実装する

作業:

1. `scripts/install-local.ps1`でbuild、local config存在確認、`codex mcp add`手順を案内する。
2. user configを無断更新せず、明示実行時だけ登録する。
3. `codex mcp list`と`/mcp`で接続を確認する。
4. 3計算ツールを代表fixtureで呼ぶsmoke testを作る。
5. invalid、timeout、runner unavailableを実クライアントで確認する。

登録例:

```powershell
codex mcp add structural-mcp `
  --env STRUCTURAL_MCP_CONFIG=C:\path\to\structural-mcp.local.json `
  -- node C:\path\to\structural-mcp\dist\index.js
```

gate:

- 新しいCodexセッションで6ツールが列挙される。
- 計算1件がjob/artifactまで完走する。
- server終了後にrunner processが残らない。

### Step 9: 運用ドキュメントとrelease gateを完成させる

作業:

1. READMEへ目的、構成、導入、設定、tool一覧を記載する。
2. troubleshootingへrunner unavailable、timeout、path拒否、stdout protocol errorを記載する。
3. `SECURITY.md`へlocal trust boundary、input/path制約、ログ方針を記載する。
4. versioningとbackward compatibility方針を記載する。
5. `npm pack --dry-run`または配布用zip内容を検査する。

gate:

- source checkoutから再現可能にinstall/build/registerできる。
- local config、jobs、入力fixture以外の実データがpackageへ混入しない。
- rollback手順が実行可能である。

## 14. テスト計画

### 14.1 unit

- Zod schemaの境界値、unknown property、NaN/Infinity拒否。
- config探索とvalidation。
- Windows path containment、case、separator、UNC、junction。
- job manifest state transition。
- artifact size/hash/media type。
- error category mapping。
- semaphoreのFIFO、cancel、deadline。

### 14.2 process contract

fake runnerで次を網羅する。

- 正常JSON 1件。
- stdout先頭/末尾の余分な文字。
- 不正UTF-8、不正JSON、schema不一致。
- exit 0なのに`ok:false`、非0なのに`ok:true`。
- hang、cancel無視、grandchild残留。
- stdout/stderr flood。
- artifact未生成、job外path、hash不一致、途中書込。

### 14.3 adapter integration

- engineごとの代表成功fixture。
- engine固有のvalidation failure。
- engine unavailable。
- timeout。
- 同じ入力の再実行。
- concurrency 2要求。

実engine testはWindowsかつ各repo rootが設定された場合だけ実行する。未設定をpass扱いで黙ってskipせず、明示的な`SKIPPED_ENGINE_NOT_CONFIGURED`としてreportする。release gateでは3engineすべて必須とする。

### 14.4 MCP protocol

- initializeとserver instructions。
- tools/listの名前、title、description、schema、annotations。
- 全ツールの成功・失敗response shape。
- cancellation。
- stdoutにMCP以外が混入しないこと。
- `structuredContent`がoutput schemaと一致すること。

### 14.5 end-to-end acceptance matrix

| Engine | Input | Expected artifact | Required checks |
|---|---|---|---|
| FrameWeb3 | static model JSON | `analysis-result.json` | case/type/count/unit、schema |
| FrameWeb3 | invalid model | none | validation/calculation category |
| WebDan2 | representative `.wdj` | `report.pdf` | return code、message、PDF header/size/hash |
| WebDan2 | same `.wdj` Markdown | `report.md` | non-empty UTF-8、expected headings |
| SoilDisp | cast-in-place JSON | `result.json` | major values、schema |
| SoilDisp | steel-soil-cement JSON | `result.json`/PDF | major values、PDF pages/text |
| SoilDisp | rotary pile JSON | `result.json`/PDF | uplift/tip values、PDF pages/text |

## 15. 開発・検証コマンド

想定script:

```powershell
npm ci
npm run build
npm run lint
npm run format:check
npm test
npm run test:contract
npm run test:protocol
npm run test:integration
```

MCP Inspectorによる確認:

```powershell
npx @modelcontextprotocol/inspector node dist/index.js
```

ローカルsmoke:

```powershell
& .\scripts\smoke-test.ps1 -Config .\config\structural-mcp.local.json
```

最終確認:

```powershell
git diff --check
git status --short
```

## 16. セキュリティ境界

- 本MVPは単一ユーザー・同一PC・信頼済みCodex host向け。
- それでもtool input、file path、runner responseはすべてuntrustedとして検証する。
- arbitrary command、arbitrary cwd、arbitrary output pathを公開しない。
- engine repository rootは設定からのみ取得し、tool callで変更できない。
- local input fileはallow root内だけ。
- job output以外のartifactを登録しない。
- child environmentをallow-listする。
- stdout/stderr、artifact、inputにbyte limitを設ける。
- engineering resultを安全保証や法令適合の断定として表現しない。
- 構造設計者の確認が必要であることをinstructionsとtool descriptionへ記載する。

Streamable HTTPへ移行する場合は別フェーズでOAuth、tenant分離、rate limit、remote storage、audit、TLSを設計し直す。STDIO用のlocal trustをHTTPへ流用しない。

## 17. versioning

独立してversionを持つ。

- MCP server version: package semver。
- MCP tool input/output schema version。
- 共通runner protocol version。
- 各engine version。
- 各engine input schema version。

互換方針:

- 公開tool名を安易に変更しない。
- optional field追加はdefaultを定義する。
- field削除、意味変更、単位変更はmajor version。
- runner protocol不一致は推測で継続せず`engine_unavailable`にする。
- job manifestには全versionを記録する。

## 18. rolloutとrollback

### rollout

1. fake runnerだけでMCP基盤を完成させる。
2. FrameWeb3をfeature flagで有効化する。
3. WebDan2を有効化する。
4. SoilDisp headless DoD後にSoilDispを有効化する。
5. 全engineの実fixture gate後に`1.0.0`候補とする。

### rollback

- Codex configで`enabled=false`または`codex mcp remove structural-mcp`により停止できる。
- engine単位で`enabled=false`にできる。
- previous package/build artifactへ戻せるようrelease tagを付ける。
- job artifactsはrollback時に削除しない。
- sibling repoを自動更新しないため、MCP rollbackが解析repoのworktreeを変更しない。

## 19. リスクと対策

| リスク | 対策 |
|---|---|
| runner未完成でMCP実装が止まる | fake runnerとcontract testを先行する |
| stdoutログがMCP/runner JSONを壊す | serverはstderr log、runnerはstrict JSON 1件、余分なtextを契約違反にする |
| WebDan2 static stateが呼出間で漏れる | 1呼出1process、engine concurrency 1 |
| GUI依存がheadless経路へ混入する | adapter testでGUI process/window非生成を確認する |
| 大きな解析結果でcontextを消費する | summaryだけ返し、完全結果はartifact化する |
| 任意path読書きになる | allow root、realpath containment、owned job rootを強制する |
| timeout後にprocessが残る | PID/親子検証付きprocess tree terminationをtestする |
| PDFのbinary hashが環境差で変わる | size/hashに加えページ数・抽出文字・主要値で回帰する |
| engine更新で契約が壊れる | protocol/engine version health check、release fixture gate |
| jobが蓄積する | 初期は明示cleanup script、実測後に安全なretentionを追加する |
| MCP SDK更新でschema/transportが変わる | package-lock固定、更新PRでprotocol suiteを全実行する |

## 20. 推奨コミット単位

1. `chore: initialize strict TypeScript MCP project`
2. `feat: add config path and owned job foundations`
3. `feat: add bounded child process runner`
4. `feat: register MCP server and common tools`
5. `feat: add FrameWeb3 adapter`
6. `feat: add WebDan2 adapter`
7. `feat: add SoilDisp adapter`
8. `test: add engine contract and end-to-end fixtures`
9. `docs: add local installation security and operations guides`

各コミットでunit/contract gateを通す。engine adapter commitは、そのengineのrunner protocol fixtureと統合テストを同時に含める。

## 21. Definition of Done

- [ ] Node 24 / TypeScript strict / ESMのMCP serverが再現可能にbuildできる。
- [ ] `package-lock.json`でMCP SDKを含む全依存が固定される。
- [ ] STDIO stdoutへMCP以外のログを出さない。
- [ ] `get_capabilities`が3engineの実状態とversionを返す。
- [ ] `frameweb_analyze`がGUI/HTTP serverなしで代表モデルを解析できる。
- [ ] `webdan_calculate`が`.wdj`からPDFとMarkdownを生成できる。
- [ ] `soildisp_calculate`が3杭種の結果JSONと任意PDFを生成できる。
- [ ] `get_job`と`read_text_artifact`がjob root外へアクセスできない。
- [ ] 全計算ツールがsummary、messages、artifact metadataを共通形式で返す。
- [ ] invalid input、engine unavailable、validation、calculation、timeout、protocol、I/Oを区別できる。
- [ ] shell文字列結合なしでrunnerを起動する。
- [ ] timeout/cancel後にchild/grandchild processが残らない。
- [ ] path traversal、symlink/junction、job外artifact、hash不一致を拒否する。
- [ ] stdout/stderr/input/artifactのsize limitがテストされる。
- [ ] engineごとのconcurrency limitとglobal limitが動作する。
- [ ] unit、contract、protocol testが成功する。
- [ ] Windows上で3engineのintegration fixture gateが成功する。
- [ ] Codexへ登録し、新規セッションで6ツールが列挙される。
- [ ] 代表3計算がCodexからjob/artifact生成まで完走する。
- [ ] README、設定例、troubleshooting、security、rollback手順が揃う。
- [ ] local config、jobs、実顧客データ、秘密情報がgit/packageへ含まれない。

## 22. 実装開始前に確定する事項

Step 0で次を実測・合意してからproduct codeを開始する。

1. FrameWeb3 headless runnerのmodule名、protocol version、解析入力上限。
2. FrameWeb3 MVPにPDF生成を含めるか、解析JSONだけにするか。
3. WebDan2 runnerの配置、publish方式、ReturnCodeとprocess exit codeの対応。
4. SoilDisp headless計画の未確定事項と実装完了時期。
5. 各engineの代表fixtureと期待主要値の正本。
6. `allowedInputRoots`の既定値を空にするか、workspace rootを自動追加するか。
   - 安全側の推奨は空で、明示設定必須。
7. job artifactをユーザーへ返す際、絶対pathを含めるかartifact IDだけにするか。
   - ローカルMVPでは絶対path併記、将来HTTP化時はIDのみを推奨する。
8. 各engineのtimeout、input/output size、同時実行数の実測値。
9. job cleanupの運用責任者と保存期間。
10. `1.0.0`にSteelDanを含めないことの最終確認。

## 23. 参考資料

- [OpenAI: Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?translationFallback=ja-JP)
- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [SoilDisp headless化・MCP連携準備 改修プラン](./soildisp-headless-mcp-plan.md)

