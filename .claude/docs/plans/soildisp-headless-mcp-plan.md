# SoilDisp headless化・MCP連携準備 改修プラン

> [!NOTE]
> `SoilDisp` は現在 `SoilStructure` submodule 内の構成要素です。この文書は旧リポジトリ配置に対する歴史的計画として保持しています。現行 submodule と実装状況は [README](../../../README.md) を参照してください。

- 状態: Proposed
- 作成日: 2026-09-20
- 対象リポジトリ: `../SoilDisp`
- 利用側リポジトリ: `structural-mcp`
- 対象ランタイム: .NET 10 / Windows

## 1. 目的

`SoilDisp`のWinForms画面を自動操作せず、AI/MCPから次の処理を決定的に実行できるheadless入口を提供する。

1. 杭・地層・群杭条件をJSONで受け取る。
2. 現行GUIと同じ入力変換・検証を行う。
3. `PileCalculator`で計算する。
4. 計算結果をJSON成果物として保存する。
5. 要求された場合だけ`PileReportRenderer`でPDFを生成する。
6. 成否、検証エラー、成果物metadataを機械可読JSONで返す。

本改修での「headless」は、`MainForm`を非表示で起動することではない。WinForms、ウィンドウハンドル、メッセージループ、ダイアログ、疑似クリックに依存せず、計算ライブラリを直接呼び出せることを指す。

## 2. 現状確認

2026-09-20時点で、計算・PDF生成の中核は既にUIから分離されている。

| 現行箇所 | 役割 | 判断 |
|---|---|---|
| `../SoilDisp/SoilStructure/Program.cs` | `MainForm`を起動するWinFormsエントリポイント | headless経路では使用しない |
| `../SoilDisp/SoilStructure/MainForm.cs` `BuildRequest()` | 画面入力を`ReportRequest`へ変換し、派生値を計算する | UI非依存部分を共通Factoryへ抽出する |
| `../SoilDisp/SoilStructure/MainForm.cs` `GeneratePdf()` | 計算、PDF生成、ファイル保存を直列実行する | 共通Serviceへ移す |
| `../SoilDisp/SoilPile/Reporting/ReportRequest.cs` | 計算コアの入力モデル | 内部計算契約として維持する |
| `../SoilDisp/SoilPile/Calculation/PileCalculator.cs` | `ReportRequest`から`ReportResult`を生成する | 変更を最小限にして再利用する |
| `../SoilDisp/SoilPile/Reporting/Pdf/PileReportRenderer.cs` | `ReportResult`からPDFバイト列を生成する | 変更を最小限にして再利用する |
| `../SoilDisp/SoilStructure/SoilStructureDocument.cs` | 入力途中を含むGUI文書を保存する | MCPの計算入力契約には使用しない |
| `../SoilDisp/SoilPile/docs/SoilPileforExcel-場所打ち杭.json` | 場所打ち杭の既存`ReportRequest`例 | 回帰基準の原資料にする |
| `../SoilDisp/SoilPile/docs/SoilPileforExcel-鋼管ソイルセメント.json` | 鋼管ソイルセメント杭の既存`ReportRequest`例 | 回帰基準の原資料にする |

`SoilPile.csproj`は`net10.0`ライブラリであり、WinFormsに依存していない。したがって計算コードの全面移植は不要である。

また、リポジトリ資料に記載されている`SoilPile.ReportApi.Local`は現在のワークツリーに存在しない。既存HTTP APIがある前提では進めず、本計画ではローカルCLIを正式なプロセス境界とする。

## 3. スコープ

### 3.1 実施すること

- AI向けの型付き一次入力モデルを追加する。
- 一次入力から既存`ReportRequest`を構築するFactoryを追加する。
- 計算、結果シリアライズ、PDF生成をまとめるServiceを追加する。
- `MainForm`を同じFactory/Serviceの利用側へ変更する。
- JSON入出力の`SoilStructure.Headless`コンソールプロジェクトを追加する。
- 場所打ち杭、鋼管ソイルセメント杭、回転杭の回帰テストを追加する。
- `structural-mcp`が安全にラップできるCLI契約と成果物契約を固定する。

### 3.2 実施しないこと

- `MainForm`の廃止、UIデザイン変更、操作フロー変更。
- 計算式、係数、丸め規則、PDFレイアウトの変更。
- `SoilDisp`内へのMCPサーバー実装。
- HTTPサーバーやWindowsサービスの追加。
- PDFをBase64で標準出力へ返すこと。
- `FrameWeb3`、`WebDan2`の改修。
- 既存ソース全体の一括フォーマット。

## 4. 目標アーキテクチャ

```text
                    +-----------------------------+
                    | SoilPile                    |
                    |                             |
GUI controls ------>| PileAnalysisRequestFactory  |
Headless JSON ----->|          |                  |
                    |          v                  |
                    |     ReportRequest            |
                    |          |                  |
                    |          v                  |
                    | PileAnalysisService          |
                    |   |- PileCalculator          |
                    |   `- PileReportRenderer      |
                    +-------------+---------------+
                                  |
                 +----------------+----------------+
                 |                                 |
         SoilStructure GUI             SoilStructure.Headless
                                          | stdout: envelope JSON
                                          | files: result.json / report.pdf
                                          v
                                     structural-mcp
```

依存方向は常に`UI/CLI -> SoilPile`とする。`SoilPile`からWinForms、MCP、CLIへ参照を戻してはならない。

## 5. 設計方針

### 5.1 一次入力と内部入力を分ける

既存`ReportRequest`には、`TipSupportMode`、`TipSoil`、`EquivalentWidthPileCount`など、GUIが入力値から決定している値が含まれる。AIにこれらの派生値を直接組み立てさせると、GUIとMCPで条件がずれる。

新しい公開入力`PileAnalysisInput`には、利用者が指定すべき一次値だけを含める。

- `schemaVersion`
- 杭種、施工条件
- 杭径、杭長、根入れ深さ
- 弾性係数または断面二次モーメント
- 単位体積重量または単位長さ重量
- 回転杭の羽根外径・内径
- 地下水位
- 地層一覧
- 橋軸方向・直角方向の群杭条件
- PDF生成要否は入力モデルではなくCLIオプションとする

`PileAnalysisRequestFactory`が現在の`MainForm.BuildRequest()`と同じ規則で次を導出する。

- 杭先端深度と地層厚合計の整合
- 杭先端土質
- `TipSupportMode`
- 杭種コードと施工条件の組合せ
- 両方向の杭本数一致
- `EquivalentWidthPileCount`

`SoilStructureDocument`は未完成セルを文字列で保持するGUI保存形式なので、headless計算入力へ流用しない。

### 5.2 計算Serviceを単一入口にする

`PileAnalysisService`を追加し、GUIとCLIが同じメソッドを呼ぶ。

```csharp
public sealed class PileAnalysisService
{
    public PileAnalysisExecution Execute(
        PileAnalysisInput input,
        bool renderPdf = false);
}
```

`PileAnalysisExecution`は少なくとも次を保持する。

- 正規化済み`ReportRequest`
- `ReportResult`
- PDF生成時だけ`byte[]? Pdf`

Serviceはファイルシステムへ書き込まない。保存先管理と原子的ファイル書込はCLI/UI側が担当する。これにより計算テストが一時ディレクトリなしで実行できる。

### 5.3 CLI契約

新規プロジェクト名は`SoilStructure.Headless`、ターゲットは`net10.0`、出力種別は`Exe`とする。`SoilPile`だけを参照し、`SoilStructure`やWinFormsは参照しない。

stdout envelopeは[統合MCPサーバー実装プランの`runner-envelope-v1`](./structural-mcp-server-plan.md#34-外部runner共通契約runner-envelope-v1)を規範とする。本節はSoilDisp固有値の具体例であり、top-level形状を独自に拡張しない。

初期コマンドは1つに限定する。

```powershell
SoilStructure.Headless.exe run `
  --input C:\jobs\123\input.json `
  --output-dir C:\jobs\123\output `
  --pdf
```

ルール:

- `--input`はUTF-8 JSONの`PileAnalysisInput`。
- `--output-dir`は呼出側がジョブごとに作成した専用ディレクトリ。
- `--pdf`省略時は計算のみ。
- 成功時は`result.json`を必ず生成する。
- `--pdf`指定時は`report.pdf`も生成する。
- ファイルは同一ディレクトリ内の一時ファイルへ書いてからrename/moveして確定する。
- stdoutは最後までUTF-8のJSONオブジェクト1件だけにする。
- 診断ログはstderrへ出す。進捗文字列をstdoutへ混ぜない。
- GUI、`MessageBox`、`Process.Start`、PDF自動表示を呼ばない。
- 既存成果物を暗黙に上書きしない。ジョブディレクトリが空でない場合は失敗させるか、呼出側が明示した一意なディレクトリだけを許可する。

成功時stdoutの例:

```json
{
  "protocolVersion": 1,
  "engine": "soildisp",
  "engineVersion": "1.0.0",
  "readiness": "production",
  "ok": true,
  "executionStatus": "success",
  "engineeringStatus": "unknown",
  "summary": {
    "inputSchemaVersion": 1,
    "pileType": "castInPlace",
    "soilLayerCount": 3,
    "tipBearingKn": 0.0,
    "isShortPile": false
  },
  "messages": [],
  "artifacts": [
    {
      "kind": "result",
      "mediaType": "application/json",
      "relativePath": "result.json",
      "bytes": 12345,
      "sha256": "..."
    },
    {
      "kind": "report",
      "mediaType": "application/pdf",
      "relativePath": "report.pdf",
      "bytes": 248551,
      "sha256": "..."
    }
  ],
  "errors": []
}
```

失敗時stdoutの例:

```json
{
  "protocolVersion": 1,
  "engine": "soildisp",
  "engineVersion": "1.0.0",
  "readiness": "production",
  "ok": false,
  "executionStatus": "failed",
  "engineeringStatus": "notRun",
  "summary": null,
  "messages": [],
  "artifacts": [],
  "errors": [
    {
      "code": "validation_error",
      "path": "soilLayers[1].thicknessM",
      "message": "層厚は0より大きい値を指定してください。"
    }
  ]
}
```

終了コード:

| code | 意味 |
|---:|---|
| 0 | 成功 |
| 2 | コマンドライン引数、入力ファイル、JSON形式の不正 |
| 3 | `ReportValidationException`または一次入力の検証エラー |
| 4 | `CalculationException` |
| 5 | 出力書込、PDF生成、その他の内部エラー |

例外のスタックトレース、ローカル絶対パス、内部クラス名はstdoutのエラー`message`へ含めない。開発診断が必要な場合だけstderrへ出す。

### 5.4 JSON規約

- UTF-8、BOMなし。
- プロパティ名はcamelCase。
- enumは数値ではなくcamelCase文字列。
- `NaN`、`Infinity`、`-Infinity`は禁止。
- 単位は現行型名どおりプロパティ名に明記する。
- 入出力双方に独立したバージョンを持たせる。
  - 入力: `schemaVersion`
  - CLI応答: `protocolVersion`
- 未知の入力プロパティを受理するか拒否するかをテストで固定する。v1では誤記検出を優先し、拒否を推奨する。
- `result.json`は`ReportResult`の完全な機械可読成果物とし、stdoutには要約とパスだけを返す。

## 6. 実装手順

### Step 0: 変更前ベースラインを固定する

変更前に次の3ケースを、現行`PileCalculator`と`PileReportRenderer`で実行する。

1. 場所打ち杭: 既存`SoilPileforExcel-場所打ち杭.json`
2. 鋼管ソイルセメント杭: 既存`SoilPileforExcel-鋼管ソイルセメント.json`
3. 回転杭: 現行GUI/既存QAで成立している条件を新しいfixtureとして固定

各ケースで以下を保存する。

- 正規化済み入力JSON
- 完全な結果JSON
- PDF
- PDFページ数
- PDF抽出テキストのハッシュ、または主要表の数値スナップショット
- 主要数値の期待値

PDFのバイナリハッシュだけを唯一のgoldenにしない。PDFライブラリのメタデータや生成順でバイト列が変わる可能性があるため、ページ数、抽出文字列、主要数値を主ゲートとする。

完了条件:

- 3杭種すべてで計算とPDF生成が成功する。
- fixtureの由来と期待値がテスト名またはREADMEに記録される。
- 変更前ベースラインの採取に`MainForm`の非表示起動を必須としない。

### Step 1: 一次入力Factoryを追加する

想定ファイル:

- `../SoilDisp/SoilPile/Execution/PileAnalysisInput.cs`
- `../SoilDisp/SoilPile/Execution/PileAnalysisRequestFactory.cs`
- `../SoilDisp/SoilPile/Execution/PileAnalysisExecution.cs`
- `../SoilDisp/SoilPile/Execution/PileAnalysisService.cs`

作業:

1. `PileAnalysisInput`と子DTOを追加する。
2. `MainForm.BuildRequest()`内のUI非依存ルールをFactoryへ移す。
3. `ReportValidator.Validate()`は`PileCalculator`内の既存防御として残す。
4. Service内で`PileCalculator`と`PileReportRenderer`を呼ぶ。
5. 既存計算式とrenderer本体は変更しない。

完了条件:

- WinForms参照なしで`PileAnalysisInput -> ReportResult`を実行できる。
- 3 fixtureで変更前と同じ主要数値になる。
- PDF抽出文字列とページ数が変更前と一致する。

### Step 2: MainFormを共通Factory/Serviceへ切り替える

想定変更:

- `../SoilDisp/SoilStructure/MainForm.cs`

作業:

1. 画面コントロールから`PileAnalysisInput`を組み立てる処理だけをGUI側に残す。
2. 杭先端土質、`TipSupportMode`、杭本数整合、相当抵抗幅用杭本数の導出をFactoryへ一本化する。
3. `GeneratePdf()`の計算・render重複をService呼出へ置き換える。
4. 現行のダイアログ文言、busy状態、PDF自動表示はGUI側の挙動として維持する。
5. `.soilstructure.json`の保存形式と読み書き互換を維持する。

完了条件:

- GUI既定値から従来どおりPDFを生成できる。
- 既存保存文書を読み込み、保存、再計算できる。
- GUIとheadlessが同じ一次入力に対して同じ`ReportRequest`を生成する。

### Step 3: Headless CLIを追加する

想定ファイル:

- `../SoilDisp/SoilStructure/Headless/SoilStructure.Headless.csproj`
- `../SoilDisp/SoilStructure/Headless/Program.cs`
- `../SoilDisp/SoilStructure/Headless/HeadlessOptions.cs`
- `../SoilDisp/SoilStructure/Headless/HeadlessResponse.cs`
- `../SoilDisp/SoilStructure/Headless/AtomicArtifactWriter.cs`
- `../SoilDisp/SoilStructure.sln`

作業:

1. `net10.0`コンソールプロジェクトを追加する。
2. `SoilPile`だけをProjectReferenceする。
3. 引数検証、JSON deserialize、Service実行、成果物保存、応答JSON出力を実装する。
4. 例外を終了コードと構造化エラーへ一元変換する。
5. Ctrl+C/プロセス終了時に一時ファイルを完成品として残さない。
6. `--help`は人向けテキストをstdoutへ出してよいが、`run`コマンドのstdoutにはJSON以外を出さない。

完了条件:

- デスクトップセッションがなくても3 fixtureを処理できる。
- `SoilStructure.dll`やWinFormsをロードしない。
- 成功・各失敗分類でstdout JSONと終了コードが一致する。

### Step 4: 自動テストを追加する

新規テストプロジェクトは`SoilStructure.Headless.Tests`とし、ソリューションへ追加する。現状の`SoilStructure.Test`ディレクトリにはテスト用csprojが存在しないため、それをテストプロジェクトとして扱わない。

最低限のテスト:

| 分類 | テスト |
|---|---|
| Factory | 3杭種の一次入力が期待する`ReportRequest`になる |
| Validation | 地層なし、地層厚不足、負値、不正enum、方向別杭本数不一致を拒否する |
| Calculation | 3杭種の主要数値が変更前baselineと一致する |
| Reporting | 3杭種のPDFが生成され、ページ数・主要文字列が一致する |
| GUI parity | GUI由来入力とheadless入力の正規化済み`ReportRequest`が一致する |
| CLI protocol | stdoutがJSON 1件だけで、成功時0、入力不正時2、検証時3、計算時4になる |
| Artifacts | `result.json`/`report.pdf`の原子的確定、SHA-256、空でないPDFを確認する |
| Safety | 既存ファイル、親ディレクトリ外、空でないジョブディレクトリへの不用意な上書きを拒否する |

浮動小数点値はJSON文字列比較ではなく、項目ごとに明示した許容差で比較する。丸め済み帳票値は帳票に表示される桁で比較する。

### Step 5: structural-mcpからの受入スモークを定義する

本StepではMCPツール本体を実装せず、呼出契約を確定する。

1. `structural-mcp`がジョブIDごとの作業ディレクトリを作る。
2. MCP入力を`PileAnalysisInput` JSONへ変換して`input.json`へ保存する。
3. 引数配列でCLIを起動する。shell文字列連結は使用しない。
4. タイムアウト時はプロセスツリーを終了する。
5. stdout JSON、終了コード、成果物の実在、PDFハッシュを検証する。
6. MCP応答には要約、警告、`artifactId`と相対pathを返す。巨大な`result.json`やPDFをそのままMCP応答へ埋め込まない。

受入条件:

- `structural-mcp`の作業ディレクトリから場所打ち杭fixtureを1回実行できる。
- GUIプロセスが生成されない。
- 成果物がジョブディレクトリ内だけに作られる。
- 失敗時にMCP側が`validation`、`calculation`、`execution`を区別できる。

## 7. 変更予定ファイル一覧

| リポジトリ | ファイル | 変更内容 |
|---|---|---|
| SoilDisp | `SoilPile/Execution/PileAnalysisInput.cs` | AI向け一次入力DTO |
| SoilDisp | `SoilPile/Execution/PileAnalysisRequestFactory.cs` | 一次入力から`ReportRequest`への変換と派生値導出 |
| SoilDisp | `SoilPile/Execution/PileAnalysisExecution.cs` | 実行結果コンテナ |
| SoilDisp | `SoilPile/Execution/PileAnalysisService.cs` | 計算と任意PDF生成の共通入口 |
| SoilDisp | `SoilStructure/MainForm.cs` | 共通Factory/Service利用へ変更 |
| SoilDisp | `SoilStructure/Headless/*` | JSON CLI実装 |
| SoilDisp | `SoilStructure/Headless/tests/*` | fixture、回帰、プロトコル、成果物テスト |
| SoilDisp | `SoilStructure.sln` | CLIとテストプロジェクトを追加 |
| SoilDisp | `docs/headless-cli.md` | CLI・JSON・終了コード契約 |
| structural-mcp | 別実装計画 | MCPツールとプロセス管理。今回は変更しない |

実装時に既存型の配置や責務と衝突する場合は、ファイル名より依存方向と契約を優先する。ただし変更範囲を広げる前に計画を更新する。

## 8. 検証コマンド

`../SoilDisp`で実行する。

```powershell
dotnet build SoilStructure.sln -c Release
dotnet test SoilStructure.sln -c Release --no-build

dotnet run --project SoilStructure/Headless/SoilStructure.Headless.csproj -c Release --no-build -- run `
  --input SoilStructure/Headless/tests/TestData/cast-in-place.json `
  --output-dir SoilStructure/Headless/tests/TestResults/cast-in-place `
  --pdf

git diff --check
```

追加で、変更対象ファイルだけをformat検証する。

```powershell
dotnet format SoilStructure.sln --verify-no-changes --include `
  SoilPile/Execution `
  SoilStructure/MainForm.cs `
  SoilStructure/Headless `
  SoilStructure/Headless/tests
```

既知のベースラインとして、ソリューション全体の`dotnet format --verify-no-changes`は既存の`PileCalculator.cs`、`PileReportRenderer.cs`、`clsSoilPile.cs`、VBファイル等の書式・CA2200違反で失敗する。これを本改修で一括修正して無関係な巨大差分を作らない。新規・変更対象の限定format、Release build、test、数値/PDF回帰を完了条件とする。

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| GUIとCLIで派生値の規則が分岐する | Factoryを単一実装にし、GUI parityテストを置く |
| `ReportResult`のJSONが将来変わる | `schemaVersion`/`protocolVersion`を分離し、MCPはstdout要約だけへ依存する |
| PDFバイト列が環境差で変わる | バイナリハッシュだけでなくページ数、抽出文字列、主要値を検証する |
| AIが単位を誤る | DTOプロパティ名に単位を残し、MCPスキーマのdescriptionへ明記する |
| 任意パス書込になる | MCPが作る専用job directoryだけを渡し、CLIで既存/親外への書込を拒否する |
| 巨大JSON/PDFでMCPコンテキストを消費する | stdoutは要約とパスだけ、完全結果とPDFは成果物ファイルにする |
| 子プロセスが残留する | timeout、CancellationToken、プロセスツリー終了、原子的成果物確定を実装する |
| 全体format修正がスコープを汚染する | 対象限定formatのみをゲートにする |
| 現行GUI保存形式を壊す | `SoilStructureDocument`を変更せず、既存文書の往復テストを維持する |

## 10. 移行・互換方針

- GUIの利用者向け操作と`.soilstructure.json`形式は維持する。
- 計算式とPDFレイアウトは変更しない。
- CLIは新規追加なので既存実行経路を置換しない。
- GUIを共通Serviceへ切り替えた後も、問題があればGUI側だけ従来呼出へ戻せるよう、Step 1とStep 2を別コミットにする。
- CLI契約を変更する場合は`protocolVersion`を上げ、旧versionを即時削除しない。

## 11. 推奨コミット単位

1. `test: capture SoilDisp calculation and PDF baselines`
2. `refactor: add shared pile analysis input factory and service`
3. `refactor: route SoilStructure MainForm through shared service`
4. `feat: add SoilStructure headless JSON CLI`
5. `test: add headless protocol and artifact regression coverage`
6. `docs: document SoilStructure headless contract`

各コミットでRelease buildと該当テストを通し、計算式変更とプロセス境界追加を同一コミットに混在させない。

## 12. Definition of Done

- [ ] `MainForm`を生成せず3杭種を計算できる。
- [ ] `SoilStructure.Headless`が`SoilStructure`/WinFormsを参照していない。
- [ ] GUIとCLIが共通Factory/Serviceを使用している。
- [ ] GUIとheadlessの正規化済み入力および主要計算結果が一致する。
- [ ] `result.json`が常に生成され、`--pdf`時だけ`report.pdf`が生成される。
- [ ] stdoutはJSON 1件、ログはstderr、終了コードは契約どおりである。
- [ ] 場所打ち杭、鋼管ソイルセメント杭、回転杭の自動回帰テストがある。
- [ ] 不正入力で構造化されたfield path付きエラーが返る。
- [ ] 成果物の原子的書込、上書き防止、ジョブディレクトリ境界が検証される。
- [ ] Release build、test、対象限定format、`git diff --check`が成功する。
- [ ] 既存GUI文書の保存・読込互換とPDF表示動作が維持される。
- [ ] `structural-mcp`からの1ケース受入スモーク手順が成功する。

## 13. 実装開始前に確定する事項

次の項目だけはStep 0で実測して確定する。未確定のまま実装を進めない。

1. 回転杭fixtureの正本となる入力と期待主要値。
2. `result.json`へ完全な`ReportResult`をそのまま出すか、versioned DTOへ写すか。
   - 初期実装は完全`ReportResult`でよいが、外部公開契約にするなら専用DTOを推奨する。
3. 空でない`--output-dir`を全面拒否するか、予約済みファイルだけの不在を要求するか。
4. CLIの配布方法。
   - 開発中は`dotnet run`/framework-dependent build。
   - MCP運用時はversion固定されたpublishディレクトリを推奨する。
5. MCPから許可する最大実行時間、入力JSONサイズ、地層数上限。
