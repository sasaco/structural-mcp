# structural-mcp 配布・開発中MCPテスト計画

- 状態: Approved decisions / implementation pending
- 更新日: 2026-09-28
- 対象: `structural-mcp`、`FEMPython`、`Capacita`、`SoilStructure`
- 開発対象OS: Windows
- MCP transport: STDIO

## 1. 承認済み設計判断

1. 公開対象は `FEMPython`、`Capacita`、`SoilStructure` とする。
2. `WebDan2` は `Capacita` の旧リポジトリ名としてのみ扱う。既存の `webdan_calculate` と `STRUCTURAL_MCP_WEBDAN_RUNNER` は互換名として当面維持する。
3. FEMPython の初期配布はオンラインbootstrap型とする。完全オフライン版は作らない。
   - MSIには `uv`、FEMPythonの固定commitから作成したwheelまたはproject配布物、`uv.lock`、bootstrap入口を含める。
   - 初回初期化時に、`uv` が固定Pythonとlock済み依存関係を取得・構築する。
   - download失敗時はMCP登録を成功扱いにせず、再実行可能な初期化エラーとして表示する。
4. 一般利用者向けの正規配布物はWindows Installer形式の `.msi` とする。source cloneやportable ZIPは開発・診断用途であり、正規インストール経路にはしない。
5. MSIは最初に `win-x64`、per-user installを対象とし、既定配置を `%LOCALAPPDATA%/Programs/structural-mcp/<version>` とする。管理者権限を前提にしない。
6. Git submoduleはrelease buildの入力であり、利用者へsubmodule操作を要求しない。MSIには固定commitから生成・検証した成果物だけを格納する。

## 2. 開発中のテスト原則

テストを次の3層に分ける。

| 層 | 目的 | 実行方法 |
|---|---|---|
| engine/runner | 各計算コアとheadless契約を高速に検証 | Python/.NET各プロジェクトの単体・process test |
| MCP protocol | tool一覧、schema、成果物、エラーを決定的に検証 | `npm test`から実serverを`StdioClientTransport`で起動 |
| Codex実利用 | AIがtoolを発見・選択し、実結果を解釈できることを確認 | `structural-mcp-dev`登録 + 新規Codex session |

Codex実利用テストだけに依存しない。数値、schema、path拒否、artifact hashは自動テストで判定し、Codex sessionではtool選択、説明、使い勝手を確認する。

## 3. 開発用MCPの一度だけの登録

release用の `structural-mcp` と開発用の `structural-mcp-dev` を分離する。開発用はこのworking treeの `dist/src/index.js` と開発buildのrunnerを直接参照する。

> [!IMPORTANT]
> 2026-09-28時点で、この端末の既存 `structural-mcp` 登録は、存在しない旧 `C:/Users/sasai/Documents/WebDan2/WebDan2.Headless/bin/Release/net8.0/WebDan2.Headless.dll` を参照している。この状態ではserver初期化が失敗するため、実計算を使った開発テストの前にCapacita submodule内へ正式なheadless runnerを確定し、`structural-mcp-dev` をそのbuildへ向ける。旧release用登録を開発用pathへ流用しない。

以下はCapacitaの正式なprotocol v1 runner配置が確定した後の形である。それまでは `$capacitaRunner` に既存の互換runnerを指定する。

```powershell
$repo = (Resolve-Path .).Path
$capacitaRunner = (Resolve-Path "<Capacita headless runnerの実path>").Path
$jobRoot = Join-Path $env:LOCALAPPDATA "structural-mcp-dev/jobs"
New-Item -ItemType Directory -Force $jobRoot | Out-Null

npm ci
npm run build

codex mcp add structural-mcp-dev `
  --env "STRUCTURAL_MCP_WEBDAN_RUNNER=$capacitaRunner" `
  --env "STRUCTURAL_MCP_JOB_ROOT=$jobRoot" `
  --env "STRUCTURAL_MCP_ALLOWED_ROOTS=$repo" `
  --env STRUCTURAL_MCP_ENABLE_STEELDAN=true `
  -- node (Join-Path $repo "dist/src/index.js")

codex mcp get structural-mcp-dev --json
codex mcp list
```

登録後はCodex CLIとCodex IDEが同じMCP設定を利用する。command、environment variable、runner pathを変えない限り、コード変更のたびに再登録する必要はない。

登録内容を変更するときだけ次を実行し、上記の `add` をやり直す。

```powershell
codex mcp remove structural-mcp-dev
```

## 4. 日常の開発ループ

### 4.1 serverだけを変更した場合

1. TypeScriptを編集する。
2. buildと自動testを実行する。
3. 新しいCodex sessionを起動する。
4. `get_capabilities` と変更対象toolを実際に呼ぶ。

```powershell
npm run build
npm test
```

反復中はTypeScript compilerをwatchさせてもよい。

```powershell
npx tsc -p tsconfig.json --watch
```

watchは `dist` を更新するだけで、既に起動済みのSTDIO MCP processを入れ替えない。build後は必ず新しいCodex sessionを使う。

### 4.2 runnerも変更した場合

1. 対象engineの単体testを実行する。
2. headless runnerを同じ固定開発pathへbuild/publishする。
3. runner単体で `capabilities` と代表fixtureを実行する。
4. `npm test` を実行する。
5. 新しいCodex sessionから同じfixtureを実行する。

runnerのファイル名とpathが同じならMCP再登録は不要である。pathを変更した場合だけ `codex mcp remove/add` を行う。

## 5. 新しいCodex sessionでの実利用テスト

対話UIではbuild後に新しいchat/sessionを開き、次の順に依頼する。

1. 「`structural-mcp-dev` の `get_capabilities` を呼び、利用可能・未接続・experimentalを区別して説明してください」
2. 「代表fixtureを使って対象engineの計算toolを呼び、`executionStatus` と `engineeringStatus` を別々に説明してください」
3. 「`get_job` と `read_text_artifact` で成果物を読み、job ID、artifact ID、hashを示してください」
4. allowed root外、拡張子違い、不正JSONなどを1件ずつ試し、安全に拒否されることを確認する。

CLIから毎回新しいsessionで確認する場合は `codex exec --ephemeral` を使う。

```powershell
$repo = (Resolve-Path .).Path
codex exec --ephemeral -C $repo `
  "structural-mcp-dev の get_capabilities toolを必ず呼び、各engineのenabledとreadinessをそのまま報告してください。"
```

計算testではfixtureの絶対pathと期待するtool名をpromptへ明示する。agentの文章だけで合否判定せず、job manifestと成果物も確認する。

## 6. 開発用scriptとして実装するもの

手順の属人化を防ぐため、次のPowerShell scriptを追加する。

| Script | 責務 |
|---|---|
| `scripts/register-dev.ps1` | build済みrunnerを検証し、`structural-mcp-dev` を登録または更新 |
| `scripts/unregister-dev.ps1` | 開発用登録だけを削除 |
| `scripts/test-dev.ps1` | engine test、MCP integration test、代表fixture smokeを順番に実行 |
| `scripts/codex-smoke-dev.ps1` | `codex exec --ephemeral` でtool discoveryと代表呼出を確認 |
| `scripts/build-release.ps1` | submodule commitを検証し、MSI staging directoryを再現可能に構築 |

scriptはrepository rootを基準に絶対pathを解決し、`$HOME` や現在のshellの偶然のcwdへ依存しない。

## 7. MSI配布設計

### 7.1 MSIに含めるもの

- structural-mcp serverの `dist`、production dependency、固定Node runtime。
- CapacitaとSoilStructureの `win-x64` self-contained headless runner。
- FEMPythonのwheel/project配布物、`uv.lock`、`uv` bootstrap。
- default config、release manifest、各fileのSHA-256。
- license notice、third-party notices。
- Codex登録・解除・health check用の署名済みlauncherまたはPowerShell script。

### 7.2 MSIとCodex登録の責務分離

MSIはfile配置、upgrade、repair、uninstallを担当する。ユーザーのCodex設定更新は、MSI custom actionへ直接埋め込まず、インストール後に明示実行する `structural-mcp register-codex` 相当のcommandへ分離する。

理由:

- Codexが未導入でもMSIを正常完了できる。
- MCP登録失敗をMSI rollbackと混同しない。
- 開発用 `structural-mcp-dev` をrelease installerが上書きしない。
- install先versionの切替とMCP再登録を個別に診断できる。

MSI完了画面またはStart Menuから「Codexへ登録」を起動できるようにする。uninstall時は、削除対象pathを現在参照しているrelease用登録だけを解除し、開発用登録は触らない。

### 7.3 FEMPython初回初期化

初回の `register-codex` または専用initialize commandで `uv sync --locked` 相当を実行する。進捗とdownload先を表示し、中断後も再実行可能にする。初期化完了前の `get_capabilities` はFEMPythonを `enabled: false`、理由を `initialization_required` または `initialization_failed` として返し、server全体は起動可能にする。

## 8. Release pipeline

1. 親repositoryと3 submoduleのcommit、version、dirty状態を検証する。
2. 全engine test、runner process test、MCP integration testを実行する。
3. .NET runnerを `win-x64` self-containedでpublishする。
4. FEMPython配布物とlockfileをstagingへ配置する。
5. Node serverと固定runtimeをstagingへ配置する。
6. clean stagingからMCP smokeを実行する。
7. MSIを生成し、署名する。
8. Windows clean VMでinstall、FEMPython online bootstrap、3 engine計算、repair、upgrade、uninstallを検証する。
9. MSI、SHA-256、release manifest、release notesを公開する。

## 9. 完了条件

- [ ] `structural-mcp-dev` とrelease用 `structural-mcp` を同じ端末で安全に併用できる。
- [ ] build後の新規Codex sessionが最新 `dist` と最新runnerを使用する。
- [ ] `npm test` が3 engineの実processを通して成功する。
- [ ] FEMPythonのonline bootstrapが新規Windows user profileで成功し、再実行可能である。
- [ ] MSIが標準のApps一覧からinstall、repair、upgrade、uninstallできる。
- [ ] MSI未導入のCodex、Codex未導入のWindowsの両方で明確な診断を返す。
- [ ] release artifactが任意の開発workspaceや絶対repository pathへ依存しない。
- [ ] clean VMで3 engineの代表fixtureと拒否系testが成功する。

## 10. 参考

- OpenAI Docs: CodexのMCP設定はCLIとIDEで共有され、`codex mcp add` と `codex mcp list` で登録・確認できる。
- この計画では、activeなSTDIO processのhot reloadを前提にせず、新しいsessionで最新buildを読み込む。
