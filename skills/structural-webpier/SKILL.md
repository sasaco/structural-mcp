---
name: structural-webpier
description: WebPier（直接基礎の鉄道 RC 橋脚の設計計算アプリ。structural-mcp の WebPier サブモジュール）で計算書を作るときに使う。0400 照査の前提（構造細目と配筋図）・0500 直接基礎の地盤ばね・0600 上部工反力・0610/0620 線路方向/直角方向の荷重・0611/0621 柱の断面照査・0612/0622 基礎の照査・0710/0720 地震時荷重・0711/0721 静的非線形解析と耐震性能照査・0800〜0820 フーチング・0900/0910 片持ち梁を、MCP の webpier_get_contract／webpier_get_input_schema／webpier_validate／webpier_generate で作り、成果物を案件の output/・export/・post/ に置く。設計資料から入力 pre/input.json（schema 2）を作る・直す、項目の意味・単位・印字桁を調べる、どの出力項目（入力の outputs）を選ぶか、要る runner（FEMPython・Capacita・JRSNAP・Aggre-SE）、engineeringStatus（ok・not_ok・not_evaluated）と実行の成否の読み分け、付帯JSONで成果物の新旧を確かめる、入力エラー・RUNNER_UNAVAILABLE・IO_ERROR・ADDIN_ERROR で失敗したとき、列車荷重でない橋脚（LRT の車荷重など）を荷重モデルのアドイン（addin、--addin）で計算するときにも使う。WebPier の実装を直すときは WebPier の repo の開発用スキルを使う。
---

# WebPier で橋脚の計算書を作る

WebPier は、入力 `pre/input.json`（schema 2）から直接基礎の鉄道 RC 橋脚の荷重計算・照査を行い、A4 白黒の計算書 PDF と結果 JSON（`output/`）、WebPier が組む頁の方眼Excel（`export/`）、各エンジンの入力と解析結果（`post/`）を作る。骨組解析は FEMPython、柱・フーチング・片持ち梁の断面照査は Capacita（RC標準 R5）、静的非線形解析は JRSNAP、耐震性能照査は Aggre-SE に任せる。structural-mcp はその生成を MCP のツールで公開している。

- 確認した版：WebPier `b6c349c`（headless runner、WebPier の決定61）、structural-mcp `91d7aca`、2026-10-19。決定62〜67（雪荷重・qu の空欄、Df の範囲の複数層、桁の高さが違う橋脚の制御節点、La/d＜2 の柱、節点番号）は WebPier `4ccae9f` で P7橋脚の全段階を実アプリで確認、2026-10-20。決定69（雪のない橋脚は雪荷重のケースを作らない）は `86188f6`（テストのみ、実アプリは未確認）。決定73（0400 照査の前提、Capacita の照査を RC標準 R5 に切替）は WebPier `bb4a2cf`（コードで確認、2026-10-21。0611・0621・0810・0820・0910 は本物の runner で受入を取り直した）。配筋図（`post/配筋図.dxf` と 4.1 の図、GridLayoutPdf v0.3.0）は WebPier `d203a32`・structural-mcp `b4551e8` で、`npm run smoke:webpier`（0400〜0612）により MCP と CLI の成果物が同じバイト列になることを確認（2026-10-21）。
- ソース（開発機のみ。structural-mcp の repo のルートから）：`WebPier/`。仕様は `WebPier/README.md`、用語は `WebPier/CONTEXT.md`。
- **WebPier の repo の `output/`・`post/`・`pre/` は案件の成果物ではない**（WebPier の開発用の見本 Example橋脚2）。案件の成果物は案件のフォルダーに置く。

## できること・できないこと

- 計算できるのは直接基礎だけ（杭基礎〔場所打ち杭・鋼管ソイルセメント杭〕は入力の形（`下部構造.基礎形式`・`杭基礎`）と検査ができ、計算できる出力項目は段ごとに広げている。いま選べるのは `detailing`・`ground_model`・`reactions`・`longitudinal`・`transverse`、場所打ち杭は `longitudinal_seismic`・`transverse_seismic`（0710・0720）と `longitudinal_nonlinear_analysis`・`transverse_nonlinear_analysis`（0711・0721）も。ほかを選ぶと `outputs.<項目>` が入力エラー。WebPier 決定84・85・88・93・94）。0612・0622 の支持層は砂質土・砂礫だけ。2線まで（列車分担 L3・L4 は空欄）。
- **寸法・配筋の最適化はしない**。入力した寸法・配筋の計算書を作るだけ。NG なら利用者が寸法・配筋を決め直す。
- 値を補わない。計算に要る値が空欄（`null`）なら入力エラー。**資料から決まらない値は推測で埋めず、利用者に聞く**。見本（Example橋脚2）の値を流用しない。
- 0611・0621・0810・0820・0910（Capacita）と 0711・0721（Aggre-SE）の照査は判定を返さない（`not_evaluated`）。OK/NG は計算書のページで読む。判定を返すのは 0400 の照査の前提と 0612・0622 の基礎の照査だけ（`ok`／`not_ok`）。

## 流れ（MCP）

1. `get_capabilities`：`engines.webpier.enabled`、`pathPolicy.allowedInputRoots`（`inputPath` で読める場所）、`pathPolicy.jobRoot`（成果物を置くときに使う）。
2. `webpier_get_contract`：出力項目ごとの `available` と `missingRunners`（使う項目の runner も含む）。作りたい項目が `unavailableOutputs` にあれば、足りない runner を利用者に伝えて止まる。runner を探して直接起動するなどの回り道をしない。
3. 入力：案件の `pre/input.json`。なければ作る。項目は `webpier_get_input_schema`、意味は `references/input-schema2.md`。資料から写した値は**印字桁に丸めて**書き（細かいと入力エラー）、どの資料のどこから写したかを `出典` に書く。
4. `webpier_validate`（`inputPath` か `input`。段階は引数では選ばない）：入力エラーは `errors[0].path` に項目のパス（例 `下部構造.寸法.側面.B1`、出力項目の誤りは `outputs.footing` など）。`summary.outputs`・`summary.stages` で作るものを確かめる。最初の1件だけが返るので、直しては繰り返す。runner の結果で決まる段階の入力エラー（0612 の反力、0910 の照査の条件など）は生成のときに出る。
5. `webpier_generate`：`ok`・`executionStatus` が実行の成否、`engineeringStatus` と `summary.stages[].engineeringStatus` が判定。
6. 成果物を置く（下の「成果物を置く」）。
7. 報告：作った計算書、段階ごとの判定（not_evaluated の段階は「計算書で確かめる」と書く）、利用者に確かめたい入力値。

- 入力ファイルが `allowedInputRoots` の外（ネットワークドライブの案件など）なら、ファイルを読んで中身を `input` に文字列で渡す（BOM なしの UTF-8 なら、結果 JSON に記録される入力の SHA-256 はファイルと同じ。名前は `input.json` になる）。
- 生成は CLI（`python -m webpier`）と同じで、バイトも同じ（`smoke:webpier`、2026-10-19）。

## 出力項目の選び方（入力の `outputs`）

作る計算書は、入力の `outputs`（出力項目、WebPier の決定72）だけで決まる。ツールの引数・CLI・runner の引数では選べない。13項目をすべて `true`／`false` で書く（入力エディタの「07 計算・印刷」のチェックと同じもの）。

| 頼まれたこと | 項目（`outputs.*`） | 段階 | 使う項目（同時に `true` が必要） | 呼ぶ runner |
|---|---|---|---|---|
| 照査の前提（柱・梁・フーチングの構造細目、配筋図） | `detailing` | 0400 | — | なし |
| 地盤のモデル化（直接基礎の地盤ばね・支持力係数。杭基礎は SOIL-JR の計算書と連携ファイル） | `ground_model` | 0500 | — | なし（杭基礎は JRSNAP） |
| 上部工反力及び橋脚自重 | `reactions` | 0600 | — | なし |
| 線路方向の計算（地震時以外。骨組解析の入力） | `longitudinal` | 0610 | `ground_model`・`reactions` | FEMPython（荷重図） |
| 線路方向の骨組解析（柱の断面照査・基礎の照査） | `longitudinal_frame_analysis` | 0611・0612 | `longitudinal` | FEMPython・Capacita |
| 線路直角方向の計算（地震時以外） | `transverse` | 0620 | `ground_model`・`reactions` | FEMPython（荷重図） |
| 線路直角方向の骨組解析 | `transverse_frame_analysis` | 0621・0622 | `transverse` | FEMPython・Capacita |
| 線路方向の計算（地震時。JRSNAP の入力） | `longitudinal_seismic` | 0710 | `ground_model`・`reactions` | JRSNAP（図） |
| 線路方向の静的非線形解析と耐震性能照査 | `longitudinal_nonlinear_analysis` | 0711 | `longitudinal_seismic` | JRSNAP・Aggre-SE |
| 線路直角方向の計算（地震時） | `transverse_seismic` | 0720 | `ground_model`・`reactions` | JRSNAP（図） |
| 線路直角方向の静的非線形解析と耐震性能照査 | `transverse_nonlinear_analysis` | 0721 | `transverse_seismic` | JRSNAP・Aggre-SE |
| フーチングの計算 | `footing` | 0800・0810・0820 | 両方向の `*_frame_analysis` と `*_nonlinear_analysis` | 4つすべて |
| 片持ち梁の計算 | `cantilever` | 0900・0910 | 両方向の `*_nonlinear_analysis` | JRSNAP・Aggre-SE・Capacita |

- 使う項目が `false` なのに `true` の項目があると、その項目の名前を入れた入力エラー（例 `outputs.footing: outputs.transverse_nonlinear_analysis も true が必要です`）。13項目すべて `false` も入力エラー。
- 選んだ項目の段階はすべて作り直す。選ばなかった項目の成果物は消さずに残る（前の世代。付帯JSON の入力の SHA-256 で見分ける）。`outputs` を変えると入力の SHA-256 も変わる。
- 地震時の項目は地震時以外の項目を使わない（WebPier の決定78）。0710・0720 は 0610・0620 なしで作れ、FEMPython も要らない（「0711 まで作って」なら `ground_model`・`reactions`・`longitudinal_seismic`・`longitudinal_nonlinear_analysis`）。
- 「0612 まで作って」なら `ground_model`・`reactions`・`longitudinal`・`longitudinal_frame_analysis` を `true` にする（0500・0600・0610 の計算書も作られる）。
- `detailing`（0400）は入力だけで作れ、runner は要らない。ただし柱・梁・フーチング（上面を含む）の配筋と `片持ち梁の照査.外観の照査` がすべて要る（空欄は入力エラー）。
- **杭基礎（`下部構造.基礎形式` が場所打ち杭・鋼管ソイルセメント杭）で選べるのは `detailing`・`ground_model`・`reactions`・`longitudinal`・`transverse`（と、場所打ち杭だけ `longitudinal_seismic`・`transverse_seismic`・`longitudinal_nonlinear_analysis`・`transverse_nonlinear_analysis`・`footing`）だけ**（`longitudinal`・`transverse` は杭を入れた骨組で、SOIL-JR の .sdc のばねをそのまま使う。SOIL-JR が動いた後に計算するので、`webpier_validate` では計算を確かめない。WebPier 決定88）（ほかは `outputs.<項目>` の入力エラー。段ごとに広がる。`webpier_get_contract` の各項目の `pileFoundation` に、選べるか〔`supported`〕・runner・ファイル〔液状化を考慮する入力だけのファイルは `conditionalFiles`〕・足りる runner〔`available`・`missingRunners`〕がある）。杭基礎の `ground_model`（0500）は **JRSNAP の runner が要り**（SOIL-JR を動かす。runner がなければ止まる）、`output/0500_杭基礎.pdf`（SOIL-JR の帳票そのもの）と `post/杭基礎.sdt`・`.sdr`・`.sdc`（液状化を考慮するときは `杭基礎(液状化時用).sdr`・`.sdc` も）を作る。SOIL-JR は判定を返さない（`not_evaluated`）。WebPier 決定85、ADR-0013。
- **地震時の項目（0710・0720）は JRSNAP の runner が要る**。JRSNAP がなければ地震時以外の6項目だけを `true` にする。
- 静的非線形解析を含む生成（`*_nonlinear_analysis`・`footing`・`cantilever`）は1方向数分かかり、JRSNAP の画面が出て、JRSNAP のインストール先の共用ファイルを書く。**実行の前に利用者に確かめる**。同じ PC で JRSNAP を同時に動かせない。
- 利用者の案件の `outputs` を勝手に書き換えない。作りたいものと違うときは、変えてよいかを確かめてから直す。
- 段階・依存・成果物の一覧は `references/stages.md`、照査の中身は `references/checks.md`。

## 荷重モデルのアドイン（車荷重など。`addin`）

列車荷重でない橋脚（LRT の車荷重など）は、案件の repo に置く荷重モデルのアドインで計算する（WebPier の決定70、ADR-0010）。`webpier_validate`・`webpier_generate`・`webpier_get_contract`・`webpier_get_input_schema` に `addin`（アドインのフォルダーの絶対パス。`allowedInputRoots` の中）を渡す。CLI・runner は `--addin <フォルダー>`。

- **`addin` を付けないと、エラーにならずに列車荷重で計算される**。アドインのある案件では毎回付ける（付けるのは呼ぶ側の責任）。入力エディタの「計算・印刷」はアドインに対応しない（列車荷重になる）ので、アドインの案件の計算書は MCP か CLI で作る。
- アドインが持つもの：死荷重以外の支承作用（基本ケースごと・支承ごとの鉛直力、線路方向・直角方向の水平力と作用高さ）、ばねの区分、地震時の固定・増分・限定増分、骨組・地震時・片持ち梁の作用の組合せ（地震時の組合せは逆向 `reverse` も持ち、アプリが照査パターン（ρm, αf）の4つに展開する）、根拠の節、来歴。アプリが持つもの：D1・D2・浮力・躯体の風・橋脚自重の慣性力 EQ2、骨組と片持ち梁の荷重への変換、各 runner、照査、計算書。
- アドインのとき、入力の荷重モデルの項目（`列車`、各側の `衝撃係数_単線終局`・`曲線半径`・`列車速度`・`遠心作用方向`、支点・支承の雪荷重と `列車分担`）は読まない（値が残っていても空でもよい。`webpier_get_input_schema` に `addin` を付けると `x-webpier-load-model` の印が付く）。アドインの入力（P7 なら `input.addin.json`）はアドインが読む。
- 組合せのない抽出ケースは断面力0で通り、計算書に「該当する組合せなし（断面力0）」と出る。その抽出ケースで Vd を割る照査（基礎の照査・フーチング）は、抽出ケースの名前を入れた入力エラーになる。
- 来歴：`summary.addin`、全結果 JSON・全付帯 JSON の `addin` に、アドインの名前・版・約束の版と、アドインが返した来歴がそのまま入る。新旧の確かめに使う。
- 失敗：`ADDIN_ERROR`（宣言 `webpier-addin.toml` がない、約束の版が違う、import や計算が失敗）はアドインの作者（案件の repo）が直す。`INPUT_ERROR` で場所が `アドイン:<基本ケースの id>…` のものはアドインが返した値の誤り、それ以外の場所のものはアドインの入力か `input.json` の誤り。
- 確認した版：WebPier（決定70 ①、2026-10-21）。代役の runner で全段階を通した。実際の FEMPython で、組合せのない抽出ケース（ty = 0 の1行）のピックアップ・反力が0になることを確かめた（2026-10-20）。

## 成果物を置く

`webpier_generate` の成果物は job の中にある（`output/output/…` が案件の `output/`、`output/export/…` が案件の `export/`、`output/post/…` が案件の `post/`）。数が多く大きい（計算書 1 つで最大 2MB、JRSNAP の結果は数十MB）ので、MCP サーバーと同じ PC なら補助スクリプトで job から複写する。スクリプトは job の `manifest.json` のバイト数と SHA-256 を全件確かめてから書く。

```powershell
node <このスキルのフォルダー>\scripts\place-webpier-outputs.mjs --job-root <pathPolicy.jobRoot> --job-id <jobId> --project <案件のフォルダー> --dry-run
node <このスキルのフォルダー>\scripts\place-webpier-outputs.mjs --job-root <pathPolicy.jobRoot> --job-id <jobId> --project <案件のフォルダー>
```

- 置く先にファイルがあると何も書かずに止まる。置き換えてよいかを利用者に確かめてから `--overwrite`。JRSNAP の結果フォルダー（`post/線路方向_JRSNAP/`）は丸ごと置き換え、この生成が作らないほかのファイルは残す（CLI と同じ）。
- 小さなものを1つだけ取るときや、MCP サーバーが別の PC のときは `read_artifact`（Base64 の範囲読み。`maxBytes` は 256KB まで）で取り、`bytes` と `sha256` を確かめてから書く。
- 各ファイルの意味、付帯JSON（`*.provenance.json`）で新旧を確かめる方法、毎回バイトが変わるファイルは `references/outputs.md`。

## 入力エディタ（GUI）

開発機のみ。structural-mcp の repo の `WebPier\` フォルダーの中から `uv run --project . --locked python -m webpier.gui --input <案件>\pre\input.json`（`<案件>` は絶対パス）。repo のルートから `--project ".\WebPier"` で起動すると `No module named 'webpier'` で失敗する（WebPier `78654a2` の実アプリで確認、2026-10-20）。数値を入力の時点で印字桁に丸め、空欄・入力エラーを赤で示す。「入力チェック」で最初の入力エラーをパス付きで示し、入力エラーがなくても鉄筋の警告（柱の元の鉄筋のない配置表の変更、梁の鉄筋の重なり、フーチングの段の交差。計算は止めない）があれば示す（WebPier `1f5c8de`）。保存の前のファイルは `input.json.<日時>.bak` に残る。

## runner を直接呼ぶ（スクリプトから使うとき）

`WebPier\run_headless.py`（protocol v1）を、その横の `.venv\Scripts\python.exe -X utf8` で起動する。コマンドは `run --input <JSON> --output-dir <空のフォルダー> [--addin <フォルダー>]`・`validate`・`contract`・`schema`（どれも `--addin` を取る。作る計算書は入力の `outputs` で決まり、`--stage` などはない）。runner の場所は環境変数（`STRUCTURAL_MCP_FEMPYTHON_RUNNER`・`STRUCTURAL_MCP_WEBDAN_RUNNER`（`.exe`）・`STRUCTURAL_MCP_JRSNAP_RUNNER`・`STRUCTURAL_MCP_AGGRESE_RUNNER`）だけから読む（`.env` は読まない）。値は `get_environment_template`。MCP があるなら MCP を使う。

## うまくいかないとき

`references/troubleshooting.md`（エラーコードごとの読み方、runner がない、パスが長い、タイムアウト、成果物が置けない）。

## 知見を足すとき

- WebPier の使い方（入力の意味、段階、成果物、照査の読み方、失敗の読み方）：このスキル（structural-mcp の `skills/structural-webpier/`）を編集し、structural-mcp で commit する。開発機ではインストール先がこのフォルダーへのジャンクションなので、そのまま全案件に効く。
- WebPier の実装・決定・受入：WebPier の repo（`.claude/skills/` の開発用スキル、`.claude/docs/plans/refactoring-decisions.md`）。エンジンそのもの：`structural-capacita`・`structural-aggrese`・`structural-jrsnap-*`。
- 案件の判断（その橋脚の条件、資料の読み替え、発注者とのやり取り）：その案件の repo。
- インストール先がコピー（MSI の利用者）のときは編集しない。案件側に書いて開発者に伝える。
- コードで確かめたこと、実アプリで試したこと、推定を区別し、日付と WebPier の版を残す。
