# structural-mcp Windows インストーラー

Windows x64 向けのユーザー単位 MSI です。Node.js と各 .NET 計算エンジンの実行環境を同梱します。利用先 PC に Node.js、.NET SDK、Python、uv、Codex CLI を個別に入れる必要はありません。Codex アプリと、初回の Python 環境構築に使うインターネット接続が必要です。Excel 帳票を作る場合だけ Microsoft Excel が必要です。

鉄道橋脚の設計計算アプリ WebPier と、Claude Code・Codex 用のスキル `structural-*` も入ります。WebPier の計算書は PC にある Windows の書体（MS明朝・MSゴシック・Calibri・Times New Roman の Italic）で組みます。JRSNAP（鉄道総研）とその runner JRSNAPHeadless は同梱しないので、WebPier の 0710 以降（JRSNAP を使う段階と、それに依存する段階）と、杭基礎の 0500（SOIL-JR を JRSNAPHeadless の runner で動かす）は使えません（杭基礎で MSI から作れるのは、鋼管ソイルセメント杭は 0400 と 0600、場所打ち杭は 0600 だけです。場所打ち杭の 0400 は 0500 の 1/β を使うため。WebPier 決定98。鋼管ソイルセメント杭の 0400 は杭の構造細目も入力だけから作る、決定99）。

## 別の PC に入れる

1. 配布された `structural-mcp-*-win-x64.msi` をコピーし、ダブルクリックしてインストールします。今回の修正版は `structural-mcp-0.2.0-preview-repairfix1-win-x64.msi`、既定の配置先は `%LOCALAPPDATA%\Programs\structural-mcp\0.2.0-preview` です。
2. スタートメニューの **structural-mcp → 1 - Setup and register Codex** を開きます。Python 3.12.12 と固定された依存パッケージ（FEMPython と WebPier の2つの環境）を取得し、計算エンジンと MCP 接続を確認してから Codex に登録し、スキルをコピーします。`SUCCESS` が表示されるまで待ち、Enter で閉じます。初回は数分かかります。
3. Codex（と Claude Code）を再起動し、新しい会話で「structural-mcp の get_capabilities を呼んで各エンジンの利用可否を確認して」と依頼します。

MSI の完了だけでは Codex に登録されません。手順 2 まで完了させてください。登録処理は Codex CLI を使わず、ユーザーの `config.toml` の `structural-mcp` 項目を更新します。既存の別の登録と衝突した場合は上書きせず停止します。

入力ファイルを直接読む既定フォルダーは `%USERPROFILE%\Documents\structural-mcp` です。ファイルをそこへ置くか、Codex にファイルを読み取らせて入力内容を MCP に渡します。計算結果とダウンロードキャッシュは `%LOCALAPPDATA%\structural-mcp` に保存します。

## WebPier

WebPier は MCP の `webpier_get_contract`・`webpier_get_input_schema`・`webpier_validate`・`webpier_generate` で使います。使い方はスキル `structural-webpier` にあります。この MSI で作れるのは 0500・0600・0610・0620 と、骨組解析（FEMPython・Capacita）を使う 0611・0612・0621・0622 です。`webpier_get_contract` は、JRSNAP の runner がないため 0710 以降を作れないと返します。WebPier の帳票ライブラリ GridLayoutPdf は、初回セットアップで GitHub Release の wheel を取得し、`engines\WebPier\uv.lock` の SHA-256 で照合します。git は要りません。

Codex の登録には `tool_timeout_sec = 1800` を書きます（WebPier の生成の上限 `STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS` の既定が30分のため）。

## スキル

セットアップは、同梱のスキル `structural-*`（解析エンジンと WebPier の使い方）を次の2か所へコピーします。新しい会話から使えます。

| クライアント | コピー先 |
|---|---|
| Claude Code | `%USERPROFILE%\.claude\skills\structural-*`（環境変数 `CLAUDE_CONFIG_DIR` があればその下の `skills`） |
| Codex | `%USERPROFILE%\.agents\skills\structural-*` |

- 置いたものは、ファイルごとの SHA-256 と一緒にインストール先の `skills-install-state.json` に記録します。
- 同じ名前のフォルダーやリンク（開発用のジャンクションなど）がすでにあると、何も変えずに止まります（Codex の登録もしません）。中身を確かめて移すか消すか、`--no-skills` を付けてスキルを置かずにセットアップしてください。
- コピーしたスキルは編集しないでください。編集されたコピーがあるとセットアップは止まり、解除・アンインストールでは消さずに残します。
- 解除（**3 - Unregister from Codex**）とアンインストールは、このインストール先が置いて変更されていないコピーだけを消します。ほかのスキルは消しません。
- **2 - Check structural-mcp** は、置いたコピーが同梱のものと SHA-256 で一致するかを確かめます。消えた・違うコピーは、セットアップをもう一度実行すると戻ります（編集したものは先に消してください）。
- 版を上げたときは `--replace-existing` を付けてセットアップすると、前の版のインストール先が置いて変更されていないコピーを引き継ぎます。

## 確認・再実行・削除

- 接続を確認する場合は **2 - Check structural-mcp** を開きます。
- MSI は実際のインストール先をユーザーのレジストリに記録し、Windows の修復・削除でも同じ配置先を使います。
- ダウンロードや初期化に失敗した場合は、ネットワーク・プロキシ設定を確認し、**1 - Setup and register Codex** を再実行します。失敗時に Codex 登録を成功扱いにはしません。
- 削除する場合は、Windows の「インストールされているアプリ」から structural-mcp をアンインストールします。このインストール先の Node と server を参照する、インストーラー管理下の登録だけを自動解除します。先に **3 - Unregister from Codex** で手動解除することもできます。
- アップグレード後は再度セットアップを実行してください。旧版のインストーラー管理下の登録を切り替える場合は、下の `--replace-existing` を使います。

Python 環境（インストール先の `engines\FEMPython\FrameWeb\.venv` と `engines\WebPier\.venv`）、ジョブ、ダウンロードキャッシュは MSI に登録した固定ファイルと分離されています。アンインストール後も生成データが残る場合があります。必要な計算結果を確認してから手動で削除してください。

登録先や入力フォルダーを指定する場合は、インストール先で PowerShell を開いて実行できます。

```powershell
.\setup.cmd --allowed-root 'C:\Work\StructuralInputs'
.\setup.cmd --replace-existing
.\setup.cmd --no-skills
.\health.cmd
.\unregister-codex.cmd
```

`--codex-home` で通常以外の Codex 設定フォルダー、`--data-root` でジョブ・Python ダウンロード先、`--skills-home` でスキルのコピー先の基準のフォルダー（その下の `.claude\skills` と `.agents\skills`。検証用）を指定できます。絶対パスを使ってください。環境変数 `STRUCTURAL_MCP_NO_PAUSE=1` は自動実行用です。PowerShell 実行ポリシーの恒久的変更は行いません。

最後に登録が成功した Codex 設定ファイルの場所をインストール先に記録し、アンインストール時の解除にも使います。解除コマンドへ明示した `--codex-home` がある場合は、その指定を優先します。複数の Codex 設定フォルダーへ登録した場合、自動解除の対象は最後に成功した登録先だけです。それ以前の場所は `unregister-codex.cmd --codex-home '<対象フォルダー>'` で個別に解除してください。

登録先の記録が壊れている場合は、`--codex-home` を指定しても解除を停止します。対象の設定フォルダーを指定してセットアップを再実行し、登録先の記録を再作成してから解除してください。

## 開発者が MSI を作る

ビルド PC には Windows x64、Node.js 24 以上、.NET SDK 10、Git と取得済み submodule が必要です。.NET 8 向けの runtime pack、固定版 Node / uv、NuGet パッケージ、WiX SDK はビルド時に取得します。

Aggre-SE（`Batch` submodule）の runner は .NET Framework 4.8 で、Visual Studio の MSBuild と、開発 PC に導入済みの SPREAD 15・ComponentOne 2015・VB-Report8（ライセンス付き）が必要です。`Batch\Aggre-SE\Headless\bin\Release` に build し、`engines\Aggre-SE` へコピーします。.NET Framework 4.8 は Windows 10/11 に標準搭載のため同梱しません。これらの部品と `itextsharp.dll` の再頒布条件は配布前に確認してください。

WebPier（`WebPier` submodule）は、`run_headless.py`・`webpier\`・`pyproject.toml`・`uv.lock`・`README.md` を `engines\WebPier` へコピーします（Python 環境は利用先で作る）。スキルは `skills\structural-*` を `skills\` へコピーします。JRSNAPHeadless（private repo）は入れません（2026-10-19、利用者の判断）。

```powershell
cd C:\path\to\structural-mcp
npm ci
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File installer/build/build-installer.ps1 -Preview
```

`-Preview` は未コミットの作業を含む開発用ビルドです。ソースの commit、dirty 状態、固定ツールの版、配布ファイルの SHA-256 を記録します。通常のビルドでは未確定のソース状態を検出して停止します。作業ツリーや submodule をリセットしません。

出力先は `.structural-mcp/installer-work/<日時-ID>/` です。

| ファイル・フォルダー | 用途 |
|---|---|
| `payload/` | インストールされるファイル群 |
| `payload/release-manifest.json` | ソース情報・固定ツール・ファイルの SHA-256 |
| `msi/structural-mcp-<version>-win-x64.msi` | コピーしてインストールする MSI |
| `msi/*.msi.sha256` | MSI 全体の SHA-256 |

`-SkipMsi` は payload 構築まで実行します。`-StagePath '<絶対 payload パス>'` は既存の staging から MSI を生成します。`-StagePath` は上記の作業フォルダー内だけを受け付けます。

## 実ファイルによる検証

```powershell
npm ci --prefix installer/runtime
node --test installer/tests/*.test.mjs
node installer/verify/payload-smoke.mjs --payload 'C:\absolute\path\payload' --initialize --relocate
```

検証は新規の一時フォルダーへ日本語・空白を含むパスでコピーし、同梱 Node から MCP を起動します。通常の Codex 設定を変更しません。開発用 PATH と runner 環境変数を外し、固定ファイルの SHA-256、Python の実体とモジュールの配置（FEMPython と WebPier）、Capacita / SoilStructure / FEMPython の実計算、PDF / PIK / CSV の取得と hash、許可外入力と不正 JSON の拒否を確認します。WebPier は、`webpier_get_contract` が JRSNAP なしで地震時以外の出力項目（0500〜0622）を作れて地震時の項目（0710・0720）は JRSNAP が足りないと返すことを確かめ、入力の写しの `outputs` を地震時以外の6項目にして（WebPier の決定72）`webpier_validate` が 0500・0600・0610・0611・0612・0620・0621・0622 を選ぶことを確かめ、1回の `webpier_generate` で作って、成果物のバイト数・SHA-256・各段階の PDF と結果 JSON を確かめます。入力は既定で `WebPier\pre\input.json`（`--webpier-input <絶対パス>` で変更、`--skip-webpier` で省略）。スキルは、作業フォルダーの下の隔離したホームへ `register-codex` でコピーして SHA-256 を照合し、`unregister-codex` で消えることを確かめます。Aggre-SE は JRSNAP の解析結果（`*.DB1` 等）が git 管理外のため、`--aggrese-xml <プロジェクトXMLの絶対パス>` を指定したときだけ、そのフォルダーをコピーして総括表を実計算します。結果は表示された作業フォルダーの `verification.json` に残します。

この検証はインストール先へ Python 環境を新規構築します。既存の `.venv` を別の PC へコピーして再利用しないでください。MSI から展開した payload も同じ検証へ渡せます。

MSI の実インストール・修復・削除を確認する場合は、次の検証を使います。関連製品が既にインストールされている PC では停止します。新しい検証フォルダーへサイレントインストールし、実ファイルの hash、削除した README の修復、隔離 Codex 登録の自動解除、隔離したホームへコピーしたスキルの自動解除（同じフォルダーの別のスキルは残ること）、製品の削除を確認します。通常の Codex 設定は前後の SHA-256 だけを照合し、内容を出力しません。ログと `lifecycle.json` は `.structural-mcp/installer-work/root-verification/` に残ります。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File installer/verify/msi-lifecycle.ps1 -MsiPath 'C:\absolute\path\installer.msi' -ExpectedSha256 '<配布物のSHA-256>'
```

## Preview の制限

この版は未署名の検証用 MSI です。クリーンな別 PC / VM での初回導入・修復・更新・削除と、署名付きの正式配布は別途確認が必要です。Windows が発行元を確認できない旨を表示することがあります。

同梱物には GrapeCity Spread、EPPlus、および計算エンジンに埋め込まれた MS Gothic / MS Mincho / SimSun 等が含まれます。既存ライセンスを変更するものではなく、それらの再配布権限はこの実装では確認していません。正式配布時には同梱の notices と権利条件を確認してください。WebPier と GridLayoutPdf の repo には LICENSE ファイルがありません。

今回のビルドでは、既存依存 `SixLabors.ImageSharp 2.1.13` について NuGet が High（`NU1903`）と Medium（`NU1902`）の既知脆弱性警告を出しています。対象は [GHSA-j3p4-wp97-rph4](https://github.com/advisories/GHSA-j3p4-wp97-rph4)、[GHSA-j9gm-c75j-xc9q](https://github.com/advisories/GHSA-j9gm-c75j-xc9q)、[GHSA-jjfr-hcj7-qf5w](https://github.com/advisories/GHSA-jjfr-hcj7-qf5w)、[GHSA-gwg2-r3hj-4w44](https://github.com/advisories/GHSA-gwg2-r3hj-4w44)、[GHSA-wmxv-xphr-5c9g](https://github.com/advisories/GHSA-wmxv-xphr-5c9g) です。このインストーラー作業では計算エンジンの依存関係を変更しておらず、正式配布前に更新・影響確認が必要です。

現行の `get_capabilities` は runner ファイルの存在で利用可否を判定します。Python 初期化前の readiness 表示だけで動作を判断せず、セットアップまたは health check の成功を確認してください。FEMPython と SteelDan は MCP 上で experimental の扱いです。

MSI のインストール時には Codex 設定を変更しません。アンインストール時だけ所有を確認して登録解除を試みます。設定ファイルが壊れている場合や所有を確認できない場合は設定を保持し、MSI の削除自体は続行します。その場合、残った登録は Codex の設定から削除してください。アップグレードで旧版を除去するときは自動解除を実行しません。
