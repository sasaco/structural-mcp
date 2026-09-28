# WebDan2 headless化・MCP連携準備 改修プラン

> [!NOTE]
> `WebDan2` は現在の `Capacita` の旧リポジトリ名です。この文書は旧構成に対する歴史的計画として保持しています。現行 submodule と実装状況は [README](../../../README.md) を参照してください。

- 状態: Proposed
- 作成日: 2026-09-20
- 対象リポジトリ: `../WebDan2`
- 利用側リポジトリ: `structural-mcp`
- 対象ランタイム: .NET 8 / Windows

## 1. 目的

`structural-mcp`から必要なときだけ`WebDan2`リポジトリ内の2つの計算コアを子プロセスとして呼び出せるよう、GUI・Azure Functions・Angularに依存しない非対話headless CLIを追加する。

対象の計算入口は次の2つである。

1. RC系: `WebDan2/WebDan2.cs` の `WebDan2.WebDan2.Main(...)`
   - 入力: `.wdj` JSON
   - 出力: PDFまたはMarkdown、Excel、通知メッセージ
2. 鋼系: `SteelDan/SteelDan.cs` の `SteelDan.SteelDan.Main(...)`
   - 入力: `.wsj` JSON
   - 出力: PDF、構造化照査結果、帳票モデル、通知メッセージ

本改修は計算エンジンをMCPサーバーへ直接組み込むものではない。`WebDan2`側に安定したローカルプロセス境界を作り、`structural-mcp`がそのプロセスをツール呼出時だけ起動する構成を成立させる。

## 2. 現状確認

2026-09-20時点の確認結果:

- `WebDan2/WebDan2.csproj`と`SteelDan/SteelDan.csproj`はいずれも`net8.0`のクラスライブラリで、単独実行可能なCLIではない。
- RC系の`Main`は`ReturnCode`、計算書の`byte[]`、Excelの`MemoryStream`、`Message`一覧を返す。
- RC系は`OutputFormat.Pdf`と`OutputFormat.Markdown`を既に選択できる。
- RC系は`ErrorMessageService`と`TranslateService.DefaultLanguage`というプロセス内の静的状態を使用する。テストも該当コレクションを並列化しない前提になっている。
- SteelDanの`Main`は`SteelDanResult`を返し、実行成否と工学的NGを分離している。
- SteelDanには追跡済みの合成fixture `SteelDanTest/Fixtures/valid-i.wsj` がある。
- RC系には`WebDan2Test/TestData/*.wdj`と`TestProject`の既存回帰fixtureがある。
- `WebDan2_Azure`はRC系をHTTPで呼べるが、Azure Functionsホストを必要とし、成果物をBase64でJSONへ埋め込み、SteelDanには対応しないため、ローカルMCPのプロセス境界には採用しない。
- 現在の`WebDan2`作業ツリーはcleanで、確認時HEADは`575636a`。
- 既存SteelDan計画ではC#パイプラインとテスト基盤は実装済みだが、実運用`.wsj`、TypeScript oracle、容量式完全互換、帳票/PDF golden、配布可能な日本語フォント方針が未完である。

## 3. スコープ

### 3.1 実施すること

- `net8.0`コンソールプロジェクト`WebDan2.Headless`を新設する。
- 1つの実行ファイルにRC系と鋼系を明示的な別サブコマンドとして持たせる。
- バージョン付きJSON応答、終了コード、成果物配置規約を定義する。
- PDF、Markdown、Excel、完全結果JSONをジョブ専用ディレクトリへ保存する。
- stdoutを小さなJSON envelope 1件に限定し、ログをstderrへ分離する。
- 入力サイズ、パス、上書き、JSON、成果物整合性を検証する。
- CLIの単体・統合・実プロセステストを追加する。
- `WebDan2.sln`へCLIとテストプロジェクトを追加する。
- ローカルpublish手順と`structural-mcp`からの受入スモーク手順を文書化する。

### 3.2 実施しないこと

- `structural-mcp`側のMCPツール実装。
- `WebDanforJS`、`WebSteelforJS`の変更。
- `WebDan2_Azure`の置換、統合、HTTP仕様変更。
- `.wdj`、`.wsj`の保存形式変更。
- RC系またはSteelDanの計算式、照査対象、帳票内容の変更。
- SteelDanのTypeScript完全互換が証明済みであるとの扱い。
- PDF・ExcelをBase64化してstdoutへ埋め込むこと。
- CLIを常駐サーバー化すること。
- 認証、クラウド保存、ジョブキュー、複数ユーザー管理。

## 4. 目標アーキテクチャ

```text
AI / Codex
    |
    | MCP tool call
    v
structural-mcp (STDIO MCP server)
    |
    | tool呼出ごとに引数配列で子プロセス起動
    v
WebDan2.Headless.exe
    |-- run-rc    --> WebDan2.WebDan2.Main(wdj, format, path)
    `-- run-steel --> SteelDan.SteelDan.Main(wsj, path)
                          |
                          v
                 job/output配下の成果物
```

`structural-mcp`はセッション中に常駐してよいが、計算エンジンは各ツール呼出時だけ別プロセスで起動する。これにより次を保証する。

- RC系の静的メッセージ・言語状態が別ジョブへ漏れない。
- 計算失敗やPDF生成失敗がMCPサーバー本体を巻き込まない。
- タイムアウト時に対象プロセスツリーだけ終了できる。
- RC系と鋼系で異なる入力・出力契約をMCPツール上でも分離できる。
- .NET 8計算器の配布・更新を`structural-mcp`本体から切り離せる。

## 5. CLI契約

### 5.1 コマンド

初期版は次の3コマンドに限定する。

```powershell
WebDan2.Headless.exe capabilities

WebDan2.Headless.exe run-rc `
  --input C:\jobs\123\input\model.wdj `
  --output-dir C:\jobs\123\output `
  --report-format markdown

WebDan2.Headless.exe run-steel `
  --input C:\jobs\456\input\model.wsj `
  --output-dir C:\jobs\456\output
```

ルール:

- `run-rc`の`--report-format`は`markdown`または`pdf`を必須指定とし、曖昧な既定値を設けない。
- `run-steel`は現行`SteelDan.Main`の印刷選択に従い、PDFが返された場合だけ保存する。
- `--input`は通常ファイル1件だけを受け付ける。標準入力、URL、ワイルドカード、ディレクトリ入力は初期版では扱わない。
- 入力はUTF-8 JSONとし、UTF-8 BOMの有無は許容する。他の文字コードは拒否する。
- 入力サイズ上限は両エンジン共通で16 MiBとする。SteelDan内部の既存上限と合わせ、RC系にもCLI境界で適用する。
- `--output-dir`は呼出側がジョブごとに用意した専用ディレクトリとし、初期版では空ディレクトリだけを受け付ける。
- 出力ファイル名はCLIが固定し、入力JSONやコマンドラインから任意の成果物名を受け取らない。
- 既存ファイルを上書きしない。
- `run-*`のstdoutにはUTF-8 JSONオブジェクトを1件だけ出力する。
- 進捗、診断、例外詳細はstderrへ出す。ユーザー入力JSON全体をログへ出さない。
- `capabilities`は計算を実行せず、利用可能なエンジン、入力形式、出力形式、readiness、プロトコルバージョンを返す。

### 5.2 成果物

RC系:

| 条件 | 成果物 |
|---|---|
| `--report-format markdown`かつ計算書あり | `report.md` |
| `--report-format pdf`かつ計算書あり | `report.pdf` |
| 入力でExcel集計が選択済み | `summary.xlsx` |
| CLI処理がエンジン呼出まで到達 | `result.json` |

鋼系:

| 条件 | 成果物 |
|---|---|
| SteelDanがPDFを返す | `report.pdf` |
| CLI処理がエンジン呼出まで到達 | `result.json` |

`result.json`はstdout要約より詳細な機械可読成果物とする。

- RC系: エンジン名、戻り値、メッセージ、要求形式、成果物metadataを保存する。現行`Main`が構造化照査結果を返さないため、計算書から値を再解析しない。
- 鋼系: `VerificationResult`一覧、`HasEngineeringFailure`、メッセージ、`ReportDocument`、成果物metadataを保存する。
- JSONはcamelCase、enumはcamelCase文字列、`NaN`/`Infinity`は禁止する。
- 成果物は同じ出力ディレクトリの一時ファイルへ書き、flush後にrename/moveして確定する。
- stdoutと`result.json`の成果物パスは出力ディレクトリからの相対パスとし、PC固有の絶対パスを公開契約にしない。
- 各成果物metadataに`kind`、`mediaType`、`relativePath`、`bytes`、`sha256`を含める。
- `result.json`自身のハッシュを同じファイル内へ再帰的に含めない。stdout envelope側で`result.json`のハッシュを返す。

### 5.3 応答envelope

stdout envelopeは[統合MCPサーバー実装プランの`runner-envelope-v1`](./structural-mcp-server-plan.md#34-外部runner共通契約runner-envelope-v1)を規範とする。本節はWebDan2/SteelDan固有値の具体例であり、top-level形状を独自に分岐させない。SteelDan固有の`Severity`、`Message`、`JsonPointer`はstdoutではそれぞれ`level`、`text`、`path`へ写し、完全なengine結果は`result.json`へ保持する。

成功例:

```json
{
  "protocolVersion": 1,
  "ok": true,
  "engine": "webdan2-rc",
  "engineVersion": "1.0.0",
  "readiness": "production",
  "executionStatus": "success",
  "engineeringStatus": "unknown",
  "summary": {
    "messageCount": 0,
    "warningCount": 0,
    "verificationCount": null
  },
  "messages": [],
  "artifacts": [
    {
      "kind": "report",
      "mediaType": "text/markdown; charset=utf-8",
      "relativePath": "report.md",
      "bytes": 12345,
      "sha256": "..."
    },
    {
      "kind": "result",
      "mediaType": "application/json",
      "relativePath": "result.json",
      "bytes": 2345,
      "sha256": "..."
    }
  ],
  "errors": []
}
```

失敗例:

```json
{
  "protocolVersion": 1,
  "ok": false,
  "engine": "steeldan",
  "engineVersion": "1.0.0",
  "readiness": "experimental",
  "executionStatus": "failed",
  "engineeringStatus": "notRun",
  "summary": null,
  "messages": [
    {
      "code": "SD-JSON-MALFORMED",
      "level": "error",
      "text": "入力JSONの形式が不正です。",
      "path": ""
    }
  ],
  "artifacts": [],
  "errors": [
    {
      "code": "engine_rejected_input",
      "message": "SteelDanが入力を処理できませんでした。"
    }
  ]
}
```

状態の意味:

- `ok`と`executionStatus`はCLIと計算処理が正常に完了したかを示す。
- `engineeringStatus`は設計照査のOK/NGを示し、実行成否と混同しない。
- SteelDanで`HasEngineeringFailure == true`の場合、`ok: true`、終了コード0、`engineeringStatus: notOk`とする。
- SteelDanで照査結果が全てOKなら`engineeringStatus: ok`、照査未実行なら`notRun`とする。
- RC系は現行公開戻り値から工学的OK/NGを安全に集約できないため、初期版は`unknown`とする。帳票文字列を解析して推測しない。
- 出力選択がすべて無効で成果物がない場合も、コアが正常終了していれば`ok: true`とし、メッセージと空の成果物一覧で表す。

### 5.4 readiness

`capabilities`と全応答に次を含める。

| engine | 初期readiness | 理由 |
|---|---|---|
| `webdan2-rc` | `production` | 既存`.wdj`回帰、PDF/Markdown/Excel経路がある |
| `steeldan` | `experimental` | 実行基盤はあるが、既存SteelDan計画の実運用oracle・容量式完全互換・PDF goldenが未完 |

`steeldan`を`production`へ変更するのは、`../WebDan2/.agents/docs/plans/steeldan-csharp-core.md`の未完ゲートを満たした別変更で行う。本CLIの実装完了だけではreadinessを昇格しない。

## 6. 終了コード

| code | 意味 |
|---:|---|
| 0 | CLIとエンジン実行が成功。工学的NGを含み得る |
| 2 | 不正なコマンド、引数、入力ファイル、サイズ、文字コード、JSON、出力ディレクトリ |
| 3 | エンジンが入力または計算を失敗として返した |
| 4 | 成果物生成、原子的書込、ハッシュ検証の失敗 |
| 5 | その他の予期しない内部エラー |

RC系の`ReturnCode.NG`とSteelDanの`IsSuccess == false`は終了コード3へ変換する。警告だけ、成果物選択なし、SteelDanの工学的NGは終了コード0とする。

## 7. 実装方針

### 7.1 新規プロジェクト

新規プロジェクト:

- `WebDan2.Headless/WebDan2.Headless.csproj`
  - `Microsoft.NET.Sdk`
  - `TargetFramework`: `net8.0`
  - `OutputType`: `Exe`
  - `WebDan2/WebDan2.csproj`と`SteelDan/SteelDan.csproj`をProjectReference
- `WebDan2.Headless.Tests/WebDan2.Headless.Tests.csproj`
  - CLI境界の単体、統合、実プロセステスト
  - fixtureは既存テストデータへLinkし、重複コピーを避ける

初期版ではコマンドライン解析用の新規NuGet依存を追加しない。3コマンドと少数オプションに限定し、小さな明示的parserを実装する。将来コマンド数が増えた時点で専用ライブラリ導入を別判断する。

### 7.2 責務分離

想定クラス:

- `Program`: 引数受付、最上位例外変換、stdout/stderr、終了コード
- `HeadlessCommandParser`: サブコマンドとオプションの厳格な解析
- `HeadlessRequestValidator`: 入力・出力ディレクトリ・サイズ・文字コードの検証
- `RcRunner`: `WebDan2.Main`の呼出しと戻り値変換
- `SteelRunner`: `SteelDan.Main`の呼出しと戻り値変換
- `AtomicArtifactWriter`: 固定名成果物の原子的書込、長さ、SHA-256
- `HeadlessResponse`群: バージョン付きstdout契約
- `ResultDocument`群: 詳細`result.json`契約
- `CapabilitiesProvider`: 計算なしで機能・readinessを返す

`Program`へ計算、ファイル書込、シリアライズを集中させない。Runnerは計算コア呼出と結果の正規化を担当し、成果物書込は共通writerへ集約する。

### 7.3 既存コアの扱い

- `WebDan2.WebDan2.Main`と`SteelDan.SteelDan.Main`の公開シグネチャを変更しない。
- CLI都合で計算式、入力DTO、帳票printerを変更しない。
- `WebDan2_Azure`の`Response`やBase64契約をCLIへ流用しない。
- `MemoryStream`は必ずCLI側でdisposeする。
- コアが返したメッセージ順序を維持する。
- RC系のメッセージIDは文字列codeへ安定変換する。例: `WDB2-0001`。元の`Level`、`ID`、`Text`も`result.json`へ保持する。
- SteelDanの`Code`、`Severity`、`Message`、`JsonPointer`は意味を変えず、stdoutの共通field `code`、`level`、`text`、`path`へ写す。engine固有の原形は`result.json`へ保持する。
- 例外スタック、ローカル絶対パス、内部型名をstdoutの`message`へ含めない。詳細はstderrへ出すが、入力本文は出さない。

### 7.4 プロセス分離と並列性

`WebDan2.Headless`自身は1プロセス1計算とし、同一プロセスで複数ジョブを処理しない。RC系の静的状態を理由に、CLI内部でジョブ並列化やサーバーモードを追加しない。

並列処理が必要な場合は`structural-mcp`がジョブごとに別プロセス・別ディレクトリを起動する。受入テストでは少なくとも2つのRC系プロセスを異なる言語fixtureで同時実行し、メッセージ・言語・成果物の交差がないことを確認する。

CLIはCtrl+Cを検知して新規成果物の確定を止める。ただし既存の同期`Main`へ安全なキャンセル境界がないため、計算途中の強制停止は`structural-mcp`側のタイムアウトとプロセスツリー終了を正本とする。

## 8. 実装手順

### Step 0: 変更前ベースラインを固定する

1. `WebDan2.sln`をRelease buildする。
2. `TestProject`と`SteelDanTest`を実行する。
3. RC系代表fixtureで直接`Main`を呼び、Markdown/PDF/Excel、メッセージ、出力なしケースを保存する。
4. SteelDanの`valid-i.wsj`で直接`Main`を呼び、PDF、構造化照査結果、工学的NG、入力不正ケースを保存する。
5. 既存SteelDan計画の未完事項とreadiness `experimental`をbaseline文書へ固定する。

完了条件:

- 既存テスト結果とHEADを記録する。
- CLI実装後の比較対象が、生成物の有無、主要metadata、メッセージ、主要構造化値で定義される。
- PDFのバイナリSHA-256だけを唯一のgoldenにしない。

### Step 1: CLI契約のRed testを先に追加する

次を実装前にテストとして固定する。

- `capabilities`のprotocol version、2 engine、形式、readiness。
- 不明コマンド、不足引数、重複引数、不明オプションの終了コード2。
- 16 MiB超過、非UTF-8、存在しない入力、ディレクトリ入力の拒否。
- 空でない出力ディレクトリ、既存成果物、出力先がファイルの場合の拒否。
- stdoutがJSONオブジェクト1件だけであること。
- 失敗時も可能な範囲で同じenvelope形状を返すこと。
- enum文字列、camelCase、非有限値拒否、決定的なプロパティと配列順序。

### Step 2: CLI基盤と安全な成果物writerを実装する

1. `WebDan2.Headless`と`WebDan2.Headless.Tests`を作成し、solutionへ追加する。
2. parser、validator、response model、終了コード変換を実装する。
3. 固定成果物名、相対パス、原子的書込、SHA-256計算を実装する。
4. stdout/stderrを分離する。
5. 予期しない例外を安全な内部エラーへ変換する。

完了条件:

- 計算器を呼ばないparser/writerテストが通る。
- 任意パス名、上書き、部分ファイル残留がない。

### Step 3: RC系`run-rc`を接続する

1. `.wdj`を検証後、元の入力パスとともに`WebDan2.Main`へ渡す。
2. 明示された形式を`OutputFormat`へ変換する。
3. reportとExcelを固定名で保存する。
4. `ReturnCode`とmessagesをenvelope・`result.json`へ写す。
5. 出力選択なしを正常系として扱う。

代表fixture:

- `TestFile01_H16Rail_Rec_3D.wdj`: 3D/pickup、日本語
- `TestFile43_RailBD_H16Rail_Rec_Manual.wdj`: manual、日本語
- `TestFile32_R5Rail_Rec_3D_EN.wdj`: 英語

完了条件:

- direct `Main`とCLIで、return code、messages、report形式、Excel有無が一致する。
- MarkdownはUTF-8で、PDFは`%PDF-`、Excelは有効なOpenXML ZIPとして検証できる。
- 日本語と英語の同時別プロセス実行で状態が交差しない。

### Step 4: 鋼系`run-steel`を接続する

1. `.wsj`を検証後、元の入力パスとともに`SteelDan.Main`へ渡す。
2. PDFを固定名で保存する。
3. `VerificationResult`と`ReportDocument`を`result.json`へ保存する。
4. `IsSuccess`と`HasEngineeringFailure`をexecution/engineering statusへ別々に変換する。
5. readinessを`experimental`として固定する。

完了条件:

- `valid-i.wsj`でdirect `Main`と照査種別、照査件数、ratio、status、messages、PDF有無が一致する。
- 工学的NGで終了コード0、`engineeringStatus: notOk`になる。
- malformed JSON、参照不正、計算不能は終了コード3になる。
- CLI追加によってSteelDanの互換未証明事項が隠れない。

### Step 5: 実プロセス・安全性・配布テストを追加する

- publish済み実行ファイルを一時ジョブディレクトリから起動する。
- working directoryに依存せず入力と成果物を処理できることを確認する。
- stdout JSON、stderr、終了コード、成果物、SHA-256を照合する。
- 2つ以上の並列プロセスを別ディレクトリで実行する。
- プロセス強制終了時に`.tmp`を完成成果物として扱わないことを確認する。
- Release publishディレクトリに開発用fixture、secret、`local.settings.json`、フロントエンド設定が混入しないことを確認する。

### Step 6: 文書とpublish手順を追加する

想定文書:

- `docs/headless-cli.md`: コマンド、JSON、終了コード、成果物、readiness
- `README.md`: headless CLIへの短い導線

開発・受入用publish例:

```powershell
dotnet publish WebDan2.Headless\WebDan2.Headless.csproj `
  -c Release `
  -r win-x64 `
  --self-contained false `
  -o artifacts\WebDan2.Headless\win-x64
```

publish成果物はGitへコミットしない。`structural-mcp`は設定またはインストールmanifestでversion固定publish先を参照し、ソースツリー内の`bin/Debug`を直接実行しない。

### Step 7: `structural-mcp`からの受入スモークを定義する

本StepではMCPツール本体を実装せず、次の受入契約を固定する。

1. MCP側がジョブIDごとに`input`と`output`ディレクトリを作る。
2. MCP入力を`.wdj`または`.wsj` JSONとして`input`配下へ保存する。
3. shell文字列連結ではなく引数配列で`WebDan2.Headless.exe`を起動する。
4. RC系と鋼系を別MCPツールとして公開する。
5. タイムアウト時はプロセスツリーを終了する。
6. stdout JSONを1件としてparseし、終了コードとの整合を確認する。
7. 返された相対パスをMCP側ジョブディレクトリへ安全に解決し、範囲外を拒否する。
8. SHA-256、サイズ、成果物実在を検証する。
9. MCP応答には小さな要約、messages、成果物参照だけを返し、PDF・Excel・完全`result.json`を埋め込まない。

受入ケース:

- RC Markdown 1件
- RC PDF + Excel 1件
- RC不正入力1件
- SteelDan正常実行1件。ただしMCP表示上も`experimental`を明示
- SteelDan工学的NG 1件
- timeout/kill 1件

## 9. テストマトリクス

| 分類 | 必須テスト |
|---|---|
| Parser | 正常3コマンド、不明/不足/重複オプション、大小文字方針 |
| Input | UTF-8/BOM、非UTF-8、malformed JSON、16 MiB境界、拡張子警告/拒否方針 |
| RC parity | Markdown、PDF、Excel、出力なし、日本語、英語、invalid input |
| Steel parity | success、engineering NG、出力なし、invalid input、構造化結果 |
| Artifact | 固定名、原子的書込、空dir、上書き拒否、サイズ、SHA-256、相対パス |
| Protocol | stdout JSON 1件、stderr分離、enum/camelCase、終了コード整合 |
| Isolation | RC日本語/英語の並列別プロセス、別job directory、静的状態非干渉 |
| Publish | Release publishを別working directoryから実行、不要ファイル非混入 |
| Regression | `TestProject`、`SteelDanTest`、solution build |

実プロセステストでタイムアウトを検証する場合、通常計算が偶然遅いことへ依存しない。テスト用に明示的に制御できるプロセスfixtureを用意するか、親側process runnerの単体テストとして分離する。

## 10. 変更予定ファイル

| リポジトリ | ファイル | 変更内容 |
|---|---|---|
| WebDan2 | `WebDan2.Headless/WebDan2.Headless.csproj` | .NET 8非対話CLI |
| WebDan2 | `WebDan2.Headless/Program.cs` | 最上位dispatch、stdout/stderr、終了コード |
| WebDan2 | `WebDan2.Headless/Commands/*` | parser、options、validation |
| WebDan2 | `WebDan2.Headless/Execution/RcRunner.cs` | RC系Main adapter |
| WebDan2 | `WebDan2.Headless/Execution/SteelRunner.cs` | SteelDan Main adapter |
| WebDan2 | `WebDan2.Headless/Artifacts/*` | 原子的書込、固定名、SHA-256 |
| WebDan2 | `WebDan2.Headless/Protocol/*` | response/result/capabilities DTO |
| WebDan2 | `WebDan2.Headless.Tests/*` | 単体・統合・実プロセステスト |
| WebDan2 | `WebDan2.sln` | CLIとtest projectを追加 |
| WebDan2 | `docs/headless-cli.md` | 公開契約と運用方法 |
| WebDan2 | `README.md` | headless CLIへの導線 |
| structural-mcp | 本計画書のみ | MCP実装は別計画・別変更 |

原則として`WebDan2/**`と`SteelDan/**`の計算コアは変更しない。実装中にadapterだけでは表現できない不足が見つかった場合、公開シグネチャや計算式を直接変えず、理由と互換影響を本計画へ追記してから別Stepとして扱う。

## 11. 検証コマンド

`../WebDan2`リポジトリルートで実行する。

```powershell
dotnet restore WebDan2.sln
dotnet build WebDan2.sln -c Release --no-restore

dotnet test TestProject\TestProject.csproj -c Release --no-build --no-restore
dotnet test SteelDanTest\SteelDanTest.csproj -c Release --no-build --no-restore
dotnet test WebDan2.Headless.Tests\WebDan2.Headless.Tests.csproj -c Release --no-build --no-restore

dotnet format WebDan2.Headless\WebDan2.Headless.csproj --verify-no-changes --no-restore
dotnet format WebDan2.Headless.Tests\WebDan2.Headless.Tests.csproj --verify-no-changes --no-restore

dotnet publish WebDan2.Headless\WebDan2.Headless.csproj `
  -c Release -r win-x64 --self-contained false `
  -o artifacts\WebDan2.Headless\win-x64

git diff --check
```

手動スモーク例:

```powershell
& .\artifacts\WebDan2.Headless\win-x64\WebDan2.Headless.exe capabilities

& .\artifacts\WebDan2.Headless\win-x64\WebDan2.Headless.exe run-rc `
  --input .\WebDan2Test\TestData\TestFile43_RailBD_H16Rail_Rec_Manual.wdj `
  --output-dir $env:TEMP\webdan2-headless-rc `
  --report-format markdown

& .\artifacts\WebDan2.Headless\win-x64\WebDan2.Headless.exe run-steel `
  --input .\SteelDanTest\Fixtures\valid-i.wsj `
  --output-dir $env:TEMP\webdan2-headless-steel
```

スモークでは実行前に専用の新規一時ディレクトリを作る。固定された既存ディレクトリを再利用して削除しない。

## 12. リスクと対策

| リスク | 対策 |
|---|---|
| RC系の静的状態がジョブ間で混ざる | 1プロセス1計算。常駐・同一プロセス並列を禁止 |
| 工学的NGをプロセス障害として扱う | execution statusとengineering statusを分離 |
| RC系の工学的結果を誤集約する | 初期版は`unknown`。Markdown/PDF文字列から推測しない |
| 巨大Base64でMCP contextを消費する | binaryを成果物へ保存し、stdoutはmetadataだけ |
| 任意パス書込・上書き | 空の専用output dir、固定ファイル名、相対パス、原子的書込 |
| 部分成果物が成功扱いされる | 一時ファイルから確定し、hash/size検証後だけenvelopeへ追加 |
| 例外や入力内容の漏えい | stdoutはuser-safe、stderrにも入力本文を出さない |
| SteelDanを完成品と誤認する | readiness `experimental`を全応答へ含め、昇格を別ゲート化 |
| CLI追加で既存API/GUIを壊す | 既存Mainを変更せず、既存2 test projectを毎回実行 |
| publish先でフォントが不足する | RC/SteelのPDF smokeをpublish成果物で実行。配布ライセンス未確認ならローカル利用に限定 |
| MS Gothic/MS Mincho等の再配布問題 | ライセンス根拠なしにCLI packageを外部配布しない。フォント方針をrelease gateにする |
| 強制停止で子プロセスやtmpが残る | MCP側process-tree kill、CLI側原子的確定、tmpを成果物として列挙しない |
| protocol変更でMCPが壊れる | `protocolVersion`を必須化し、破壊的変更ではversionを上げる |

## 13. 移行・互換方針

- `WebDan2.Main`と`SteelDan.Main`は既存利用者のため維持する。
- Azure Functions、Windowsテストアプリ、Angularの挙動は変更しない。
- CLIは新規追加なので既存入口を置換しない。
- `WebDan2_Azure`の既存responseは変更しない。
- CLI v1では入力ファイル形式そのものを再定義せず、既存`.wdj`/`.wsj`をそのままコアへ渡す。
- stdout契約を変更する場合、追加フィールドは後方互換とし、削除・意味変更では`protocolVersion`を上げる。
- `structural-mcp`は未知のprotocol versionを黙って処理せず、明示的にunsupportedとして失敗させる。

## 14. 推奨コミット単位

1. `test: define WebDan headless protocol and artifact contracts`
2. `feat: add WebDan2 headless command and atomic artifact writer`
3. `feat: expose RC calculation through headless CLI`
4. `feat: expose SteelDan calculation with experimental readiness`
5. `test: add published-process isolation and failure coverage`
6. `docs: document WebDan2 headless CLI contract`

計算コア変更、CLI境界追加、MCP実装を同一コミットへ混在させない。

## 15. Definition of Done

- [ ] `WebDan2.Headless`がGUI、Angular、Azure Functionsホストなしで起動する。
- [ ] `run-rc`が既存`.wdj`からMarkdownまたはPDFと、選択時のExcelを生成する。
- [ ] `run-steel`が既存`.wsj`から構造化結果と、選択時のPDFを生成する。
- [ ] RC系と鋼系が明示的に別サブコマンドである。
- [ ] 1プロセス1計算で、RC系の静的状態をジョブ間共有しない。
- [ ] stdoutはJSON 1件、診断はstderr、binary/Base64はstdoutへ出ない。
- [ ] execution statusとengineering statusが分離されている。
- [ ] SteelDanのreadinessが`experimental`として返る。
- [ ] 成果物が固定名・相対パス・原子的書込で、SHA-256とsizeを持つ。
- [ ] 空でない出力先、既存成果物、16 MiB超過、非UTF-8、不正JSONを安全に拒否する。
- [ ] direct `Main`とCLIのparity testがRC系・鋼系とも通る。
- [ ] 日本語/英語RC系の並列別プロセス試験で状態が交差しない。
- [ ] Release publish成果物を別working directoryから実行できる。
- [ ] `TestProject`、`SteelDanTest`、`WebDan2.Headless.Tests`、Release buildが成功する。
- [ ] 対象限定formatと`git diff --check`が成功する。
- [ ] `WebDanforJS`、`WebSteelforJS`、`WebDan2_Azure`に不要な差分がない。
- [ ] `docs/headless-cli.md`にコマンド、JSON、終了コード、readiness、成果物規約が記載される。
- [ ] `structural-mcp`からのRC 1件・Steel 1件の受入スモーク手順が成功する。

## 16. 実装開始前に確定する事項

Step 0～1で次を実測して固定する。判断が必要な項目は、初期推奨を併記する。

1. RC系`Message.Level`の実在値と正規化規則。
   - 推奨: `info`、`warning`、`error`、`fatal`へ明示mapし、未知値は`error`へ黙って落とさず`unknown`として保持する。
2. RC系で計算書・Excelがどちらも未選択の場合の`result.json`内容。
   - 推奨: 正常応答とmessagesを残し、成果物は`result.json`だけにする。
3. SteelDanの`ReportDocument`を`result.json`へ全量保存した場合の最大サイズ。
   - 推奨: stdoutには要約だけ、全量は`result.json`。上限超過時は黙って切らず明示エラーとする。
4. publish方式。
   - 推奨: 開発中はframework-dependent `win-x64` publish。外部配布はフォントライセンスとランタイム配布方針の承認後に別途決定する。
5. `structural-mcp`でのタイムアウト値と同時実行数。
   - 本CLIでは決めず、代表fixtureの実測時間・最大成果物サイズをStep 5で記録し、MCP側計画の入力値にする。
6. SteelDanの本番公開条件。
   - 既存`steeldan-csharp-core.md`の実運用oracle、容量式、帳票/PDF、フォントの受入完了を必須とし、本CLI実装だけでは`production`へ上げない。
