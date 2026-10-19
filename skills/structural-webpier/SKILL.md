---
name: structural-webpier
description: WebPier（直接基礎の鉄道 RC 橋脚の設計計算アプリ。structural-mcp の WebPier サブモジュール）で計算書を作るときに使う。0500 直接基礎の地盤ばね・0600 上部工反力・0610/0620 線路方向/直角方向の荷重・0611/0621 柱の断面照査・0612/0622 基礎の照査・0710/0720 地震時荷重・0711/0721 静的非線形解析と耐震性能照査・0800〜0820 フーチング・0900/0910 片持ち梁を、MCP の webpier_get_contract／webpier_get_input_schema／webpier_validate／webpier_generate で作り、成果物を案件の output/・post/ に置く。設計資料から入力 pre/input.json（schema 2）を作る・直す、項目の意味・単位・印字桁を調べる、どの段階とスイッチ（frameAnalysis・nonlinearAnalysis）を選ぶか、要る runner（FEMPython・Capacita・JRSNAP・Aggre-SE）、engineeringStatus（ok・not_ok・not_evaluated）と実行の成否の読み分け、付帯JSONで成果物の新旧を確かめる、入力エラー・RUNNER_UNAVAILABLE・IO_ERROR で失敗したときにも使う。WebPier の実装を直すときは WebPier の repo の開発用スキルを使う。
---

# WebPier で橋脚の計算書を作る

WebPier は、入力 `pre/input.json`（schema 2）から直接基礎の鉄道 RC 橋脚の荷重計算・照査を行い、A4 白黒の計算書 PDF と結果 JSON（`output/`）、各エンジンの入力と解析結果（`post/`）を作る。骨組解析は FEMPython、柱・フーチング・片持ち梁の断面照査は Capacita、静的非線形解析は JRSNAP、耐震性能照査は Aggre-SE に任せる。structural-mcp はその生成を MCP のツールで公開している。

- 確認した版：WebPier `b6c349c`（headless runner、WebPier の決定61）、structural-mcp `91d7aca`、2026-10-19。
- ソース（開発機のみ。structural-mcp の repo のルートから）：`WebPier/`。仕様は `WebPier/README.md`、用語は `WebPier/CONTEXT.md`。
- **WebPier の repo の `output/`・`post/`・`pre/` は案件の成果物ではない**（WebPier の開発用の見本 Example橋脚2）。案件の成果物は案件のフォルダーに置く。

## できること・できないこと

- 直接基礎だけ（`下部構造.杭種` は「直接基礎」。場所打ち杭は入力エラー）。0612・0622 の支持層は砂質土・砂礫だけ。2線まで（列車分担 L3・L4 は空欄）。
- **寸法・配筋の最適化はしない**。入力した寸法・配筋の計算書を作るだけ。NG なら利用者が寸法・配筋を決め直す。
- 値を補わない。計算に要る値が空欄（`null`）なら入力エラー。**資料から決まらない値は推測で埋めず、利用者に聞く**。見本（Example橋脚2）の値を流用しない。
- 0611・0621・0810・0820・0910（Capacita）と 0711・0721（Aggre-SE）の照査は判定を返さない（`not_evaluated`）。OK/NG は計算書のページで読む。判定を返すのは 0612・0622 の基礎の照査だけ（`ok`／`not_ok`）。

## 流れ（MCP）

1. `get_capabilities`：`engines.webpier.enabled`、`pathPolicy.allowedInputRoots`（`inputPath` で読める場所）、`pathPolicy.jobRoot`（成果物を置くときに使う）。
2. `webpier_get_contract`：作りたい選択の `available` と `missingRunners`。使えない段階（`unavailableStages`）は、足りない runner を利用者に伝えて止まる。runner を探して直接起動するなどの回り道をしない。
3. 入力：案件の `pre/input.json`。なければ作る。項目は `webpier_get_input_schema`、意味は `references/input-schema2.md`。資料から写した値は**印字桁に丸めて**書き（細かいと入力エラー）、どの資料のどこから写したかを `出典` に書く。
4. `webpier_validate`（`inputPath` か `input`、`stage`・`frameAnalysis`・`nonlinearAnalysis`）：入力エラーは `errors[0].path` に項目のパス（例 `下部構造.寸法.側面.B1`）。最初の1件だけが返るので、直しては繰り返す。runner の結果で決まる段階の入力エラー（0612 の反力、0910 の照査の条件など）は生成のときに出る。
5. `webpier_generate`：`ok`・`executionStatus` が実行の成否、`engineeringStatus` と `summary.stages[].engineeringStatus` が判定。
6. 成果物を置く（下の「成果物を置く」）。
7. 報告：作った計算書、段階ごとの判定（not_evaluated の段階は「計算書で確かめる」と書く）、利用者に確かめたい入力値。

- 入力ファイルが `allowedInputRoots` の外（ネットワークドライブの案件など）なら、ファイルを読んで中身を `input` に文字列で渡す（BOM なしの UTF-8 なら、結果 JSON に記録される入力の SHA-256 はファイルと同じ。名前は `input.json` になる）。
- 生成は CLI（`python -m webpier`）と同じで、バイトも同じ（`smoke:webpier`、2026-10-19）。

## 段階とスイッチの選び方

| 頼まれたこと | `stage` | 呼ぶ runner |
|---|---|---|
| 直接基礎の地盤ばね・支持力係数 | `0500` | なし |
| 上部工反力・橋脚自重 | `0600` | なし |
| 線路方向／直角方向の荷重（骨組解析の入力） | `0610`／`0620` | FEMPython（荷重図） |
| 線路方向／直角方向の柱の断面照査 | `0611`／`0621` | FEMPython・Capacita |
| 線路方向／直角方向の基礎の照査 | `0612`／`0622` | FEMPython |
| 地震時の荷重（JRSNAP の入力） | `0710`／`0720` | JRSNAP（図） |
| 静的非線形解析と耐震性能照査 | `0711`／`0721` | JRSNAP・Aggre-SE |
| フーチングの応答値／断面照査 | `0800`／`0810`・`0820` | FEMPython・JRSNAP・Aggre-SE／＋Capacita |
| 片持ち梁の応答値／断面照査 | `0900`／`0910` | JRSNAP・Aggre-SE／＋Capacita |
| まとめて | `all`（＋`frameAnalysis`・`nonlinearAnalysis`） | 選択による |

- 1つの段階を選ぶと、依存する段階は内部で計算するだけで、その計算書は作らない（例外：0800・0810・0820・0900・0910 は、runner を動かす依存段階も一緒に作る）。「0612 まで作って」で 0500〜0610 の計算書も要るなら、段階ごとに呼ぶか `all` にする。
- スイッチは `stage: "all"` とだけ使う（1つの段階と組み合わせると入力エラー）。`all` は 0500・0600・0610・0620・0710・0720。`frameAnalysis` で 0611・0612・0621・0622、`nonlinearAnalysis` で 0711・0721・0900・0910、両方で 0800・0810・0820 が加わる。**`all` でも 0710・0720 のために JRSNAP の runner が要る**（なければ `all` は使えない）。
- 0711・0721 を含む生成（`nonlinearAnalysis`、0800〜0910）は1方向数分かかり、JRSNAP の画面が出て、JRSNAP のインストール先の共用ファイルを書く。**実行の前に利用者に確かめる**。同じ PC で JRSNAP を同時に動かせない。
- 段階・依存・成果物の一覧は `references/stages.md`、照査の中身は `references/checks.md`。

## 成果物を置く

`webpier_generate` の成果物は job の中にある（`output/output/…` が案件の `output/`、`output/post/…` が案件の `post/`）。数が多く大きい（計算書 1 つで最大 2MB、JRSNAP の結果は数十MB）ので、MCP サーバーと同じ PC なら補助スクリプトで job から複写する。スクリプトは job の `manifest.json` のバイト数と SHA-256 を全件確かめてから書く。

```powershell
node <このスキルのフォルダー>\scripts\place-webpier-outputs.mjs --job-root <pathPolicy.jobRoot> --job-id <jobId> --project <案件のフォルダー> --dry-run
node <このスキルのフォルダー>\scripts\place-webpier-outputs.mjs --job-root <pathPolicy.jobRoot> --job-id <jobId> --project <案件のフォルダー>
```

- 置く先にファイルがあると何も書かずに止まる。置き換えてよいかを利用者に確かめてから `--overwrite`。JRSNAP の結果フォルダー（`post/線路方向_JRSNAP/`）は丸ごと置き換え、この生成が作らないほかのファイルは残す（CLI と同じ）。
- 小さなものを1つだけ取るときや、MCP サーバーが別の PC のときは `read_artifact`（Base64 の範囲読み。`maxBytes` は 256KB まで）で取り、`bytes` と `sha256` を確かめてから書く。
- 各ファイルの意味、付帯JSON（`*.provenance.json`）で新旧を確かめる方法、毎回バイトが変わるファイルは `references/outputs.md`。

## 入力エディタ（GUI）

開発機のみ。structural-mcp の repo の `WebPier\` フォルダーの中から `uv run --project . --locked python -m webpier.gui --input <案件>\pre\input.json`（`<案件>` は絶対パス）。repo のルートから `--project ".\WebPier"` で起動すると `No module named 'webpier'` で失敗する（WebPier `78654a2` の実アプリで確認、2026-10-20）。数値を入力の時点で印字桁に丸め、空欄・入力エラーを赤で示す。「入力チェック」で最初の入力エラーをパス付きで示す。保存の前のファイルは `input.json.<日時>.bak` に残る。

## runner を直接呼ぶ（スクリプトから使うとき）

`WebPier\run_headless.py`（protocol v1）を、その横の `.venv\Scripts\python.exe -X utf8` で起動する。コマンドは `run --input <JSON> --output-dir <空のフォルダー> [--stage …] [--frame-analysis true|false] [--nonlinear-analysis true|false]`・`validate`・`contract`・`schema`。runner の場所は環境変数（`STRUCTURAL_MCP_FEMPYTHON_RUNNER`・`STRUCTURAL_MCP_WEBDAN_RUNNER`（`.exe`）・`STRUCTURAL_MCP_JRSNAP_RUNNER`・`STRUCTURAL_MCP_AGGRESE_RUNNER`）だけから読む（`.env` は読まない）。値は `get_environment_template`。MCP があるなら MCP を使う。

## うまくいかないとき

`references/troubleshooting.md`（エラーコードごとの読み方、runner がない、パスが長い、タイムアウト、成果物が置けない）。

## 知見を足すとき

- WebPier の使い方（入力の意味、段階、成果物、照査の読み方、失敗の読み方）：このスキル（structural-mcp の `skills/structural-webpier/`）を編集し、structural-mcp で commit する。開発機ではインストール先がこのフォルダーへのジャンクションなので、そのまま全案件に効く。
- WebPier の実装・決定・受入：WebPier の repo（`.claude/skills/` の開発用スキル、`.claude/docs/plans/refactoring-decisions.md`）。エンジンそのもの：`structural-capacita`・`structural-aggrese`・`structural-jrsnap-*`。
- 案件の判断（その橋脚の条件、資料の読み替え、発注者とのやり取り）：その案件の repo。
- インストール先がコピー（MSI の利用者）のときは編集しない。案件側に書いて開発者に伝える。
- コードで確かめたこと、実アプリで試したこと、推定を区別し、日付と WebPier の版を残す。
