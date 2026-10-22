# Phase 4：WebPier の runner と MCP ツール

- 状態: 完了（2026-10-19）
- 更新日: 2026-10-19
- 親の計画: global-engine-skills-plan.md の Phase 4（§5.1・§5.2）
- 引継ぎ元: HANDOFF.md

## 作業項目

- ✅ 現状を確かめる（各 submodule の status・pointer、Batch の bin\Release の出どころ、WebPier の別のセッションの有無）
- ✅ 0. Batch：9c70f54 を MSBuild で build、Aggre-SE.Test（22件）、（確認）pointer の更新（`1423773`）、npm test・smoke:aggrese
- ✅ 1. WebPier：headless の契約の細部を決める（下の「設計の考え方と背景」、WebPier の決定61）
- ✅ 1. WebPier：headless.py と run_headless.py、テスト、品質ゲート（3762件、pipeline 100%）、commit `b6c349c`、（確認）push
- ✅ 2. structural-mcp：config・runner・contracts・server・タイムアウト・capabilities・environment template
- ✅ 2. structural-mcp：代役 fake-webpier-runner.mjs と mcp.test.ts、npm test（61件すべて成功）
- ✅ 2. structural-mcp：README・CLAUDE.md、（確認）WebPier の pointer の更新（`b6c349c`）、commit
- ✅ 3. smoke:webpier を作り、CLI と MCP の出力のバイトを比べる（0612 は全8ファイル一致。下の「実物での確認」）
- ✅ structural-mcp-dev で新しいセッションから呼べることを確かめる（下の「新しいセッションからの確認」）
- ✅ 親の計画書の Phase 4 に ✅ と結果

## 始めたときの状態（2026-10-19）

| repo | ブランチ | HEAD | 作業ツリー |
|---|---|---|---|
| structural-mcp | `sassa/skills` | `cbecd69`（push していない） | 自分のものではない未コミット：`Capacita`（`-dirty`）、`FEMPython`（別のセッションの `sasa/nonli` の `b2584ce`）、`.claude/skills/`、`HANDOFF.md`。commit に含めない |
| Batch | detached | `47d1654`（gitlink） | clean。`origin/sasa/dev` = `9c70f54`（`47d1654` → `14ed213` → `9c70f54`） |
| WebPier | `main` | `f4aabca` | clean |
| JRSNAPHeadless | `main` | `9e3c8fe` | clean。`bin/Release/JRSNAP.Headless.exe` ほか build 済み |

- Batch の `bin/Release/AggreSE.Headless.exe` は 2026-10-19 10:38 の build（`9c70f54` の commit は 17:21）。exe の中に UTF-16 の文字列 `foundation-steps` があるので、`--foundation-steps` を足した作業ツリーから commit の前に build したものと見られる。どの commit と同じかはバイトでは決められないので、`9c70f54` から build し直す。

## 確認を取った操作（いつ・何を・利用者の返事・結果）

| いつ | 何を | 返事 | 結果 |
|---|---|---|---|
| 2026-10-19 | structural-mcp で Batch の pointer を 47d1654 → 9c70f54 に進める commit（push しない） | 「commit する」 | `git commit --only Batch` で `1423773`（Batch だけ） |
| 2026-10-19 | WebPier の headless の commit を、品質ゲートの通過後に origin へ push | 「ゲート通過後に push」 | ゲート pass（3762 passed、18分55秒、core・inputs・calc・export・pipeline 100%、reporting 99.59%、gui 94.64%）の後、`git commit --only <自分の15ファイル>` で `b6c349c`。`main` で `origin/main` との差 1 を確かめて `f4aabca..b6c349c main -> main` |
| 2026-10-19 | structural-mcp で WebPier の pointer と Phase 4 の server の変更を commit（push しない） | 「commit する」 | （smoke の後に記入） |
| 2026-10-19 | smoke:webpier の範囲 | 「0612 だけ」（`--nonlinear-analysis` は動かさない） | 0612 のほか、JRSNAP・Aggre-SE を使わない 0610・0611 も比べた（下の「実物での確認」）。JRSNAP・Aggre-SE は動かしていない |

## 設計の考え方と背景

### WebPier の headless runner（`webpier/pipeline/headless.py`、WebPier の決定61）

```text
run      --input <JSON> --output-dir <空のフォルダー> [--stage <段階|all>] [--frame-analysis true|false] [--nonlinear-analysis true|false]
validate --input <JSON> [--output-dir <フォルダー>] [--stage ...] [--frame-analysis ...] [--nonlinear-analysis ...]
contract                 段階の表（stages.py の Registry から作る）
schema                   入力の JSON Schema（fields.py の FIELDS から作る）
```

- **生成は既存の `generate()` をそのまま呼ぶ**。`--output-dir` の下の `output/`・`post/` を `GenerationOptions` の出力先にする（`--overwrite` は付けない。MCP の出力先は常に空）。
- **runner は環境変数だけ**：生成の前に、選んだ段階が要る runner（`generate.py` に新設する `required_runners`。`_runner` などと同じ述語）を各モジュールの `runner_path(dotenv=False)` で確かめ、欠けていれば `RUNNER_UNAVAILABLE`（欠けたものを全部 `summary.missingRunners` に）。この確認を通った runner は環境変数にあるので、`generate()` が `.env` を読むことはない。
- **終了コードと envelope**：0→`ok: true`。2→`ok: false` で `errors[0].code` を `INPUT_ERROR`（`InputError`）／`RUNNER_UNAVAILABLE`／`ENGINE_FAILED`（`GenerationError` の原因が `RunnerError`）／`GENERATION_FAILED`（その他の `GenerationError`。帳票が組めない、生成中の変更）／`IO_ERROR`（`OSError`）。3→`RECOVERY_REQUIRED`（MCP の出力先は空なので起きない想定）。引数の誤りも envelope（`INVALID_ARGUMENT`、exit 2）。
- **入力エラーの項目のパス**：メッセージの先頭が入力のパス（`<パス>: …`・`入力項目がありません: <パス>`。最初の区切りが `TOP_KEYS` のどれか）ならそれを `messages` と `errors` の `path` に入れる（`headless.input_path`。`InputError` に属性を足す案は、計算層の約100か所の raise を直す必要があるのでやめた）。
- **artifacts**：`Candidate.artifacts` の公開先を全部。`kind` は役割（`0610.pdf`・`0610.frameweb.provenance`）の `.` を `-` にしたもの（`0610-pdf`。MCP は kind を artifactId にする）。JRSNAP の結果フォルダーは中のファイルを1つずつ同じ kind（`0711-jrsnap`）で並べる。`relativePath` は `output/…`・`post/…`（フォルダーは `post/線路方向_JRSNAP/…`）。mediaType は拡張子から（テキストは UTF-8 で読めれば `charset=utf-8`、読めなければ `charset=shift_jis`。JRSNAP の結果・xlsx は binary）。
- **summary**：`command`・`stage`・`frameAnalysis`・`nonlinearAnalysis`、`stages`（実行した段階ごとに `id`・`stem`・`engineeringStatus`）、`runners`（使った runner ごとに engine・環境変数・`engineVersion`。付帯JSONと結果JSONの `engine`/`engine_version` から集める）、`input`（ファイル名・SHA256）、`implementationSha256`。
- **engineeringStatus**：段階ごとは結果の `engineering_status`（0612・0622 の ok/not_ok）、ほかは `not_evaluated`。全体は 1つでも not_ok なら `not_ok`、判定した段階がすべて ok なら `ok`、判定した段階がなければ `not_evaluated`（親の計画書 §5.2 のとおり。ok は「判定した段階が ok」の意味で、Capacita・Aggre-SE の照査は not_evaluated のまま段階ごとに返す）。
- **validate**：入力の解析と、選んだ段階の runner の前に決まる計算・外部出力・Aggre-SE のプロジェクトの入力の検査まで（generate の `prepare` の前半と同じ関数を使う）。runner は呼ばず、帳票も書かない。runner の結果で仕上げる段階（0612 の反力、0910 の片持ち梁の照査の条件など）の入力エラーは生成のときにしか出ない。`summary.requiredRunners` に選択が要る runner を返す。
- **contract**：段階ごとに `id`・`stem`・`dependsOn`・`optIn`・`hasReport`、直接選んだときに一緒に生成する段階と要る runner と公開するファイル（`planned()` から）、`all` とスイッチの4通りの同じ表。MCP の `webpier_get_contract` はこれに「いまの環境で使えるか」を足す。
- **schema**：`FIELDS` のパターンから入れ子の JSON Schema（Draft 2020-12）を作る。葉は型・選択肢（`enum`）・整数の範囲・正負、`x-webpier-unit`・`x-webpier-digits`・`x-webpier-reserved`。必須と項目間の規則は書かない（`webpier_validate` が正）。`schema_version`・`鉄筋.version` は定数。

### structural-mcp 側（要点）

- `runEngine` は `.py` を `<スクリプトのフォルダー>\.venv\Scripts\python.exe -X utf8 <script>` で起動する。WebPier の runner にだけ、検出した4つの runner のパスを `STRUCTURAL_MCP_*_RUNNER` で渡す（`runEngine` に追加の環境変数の引数）。
- `contract`・`schema` は入力も出力先もいらないので、`runEngine` で `--input`・`--output-dir` を省けるようにした（`null`。job を作らない）。呼ぶたびに runner を起動する（1〜2秒。覚えておくと WebPier を直したときに古い契約を返す）。
- `CalculationSpec.timeoutMs`：`webpier_generate` は**いつも** `STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS`（既定 30 分）。`nonlinearAnalysis` のときだけにしなかったのは、`all` も FEMPython の荷重図・JRSNAP の図・骨組解析を続けて呼び、180 秒を超えうるため。`webpier_validate` は runner を呼ばないので既定のまま。
- **入力は名前とバイトのまま job へ**（`jobs.ts: createNamedJsonJob`）。WebPier は入力のファイル名と SHA-256 を結果 JSON・付帯JSONに書くので、既存の `createJob`（`model.json` に UTF-8 で書き直し、JSON の BOM を落とす）では CLI と同じバイトにならず、案件の `pre/input.json` との対応も切れる。inline の入力は `input.json`。
- **WebPier に渡す環境**：最小の環境＋検出した runner の `STRUCTURAL_MCP_*_RUNNER` だけ。Capacita は server では `.dll`（dotnet で起動）だが、WebPier は runner を実行ファイルとして直接起動するので、横の `.exe`（apphost）を渡す（なければ渡さない＝使えない）。JRSNAP は検出しても MCP ツールはない（§10）。
- **artifact の ID**：MCP は kind を ID にし、重複には `-2` 以降を付ける。直す前は重複のときだけ kind を正規化せずに使っていた（`0711.jrsnap-2` のような `.` を含む ID ができ、保存した manifest の検査 `^[a-zA-Z0-9_-]+$` に合わない）ので、正規化した ID に番号を付けるように直した（`jobs.ts: verifyArtifacts`）。WebPier の kind は最初から `-` 区切り。
- **engineeringStatus の集約**：「判定した段階がすべて ok なら ok」とした。0500 などの計算の段階は判定しないので、「全段階が ok なら ok」にすると ok が出ることがない。段階ごとの値を `summary.stages` で必ず返し、Capacita・Aggre-SE の照査が not_evaluated であることを MCP の説明にも書いた。
- **生成物が多いとき**：§5.2 のとおり、まず `read_artifact` で1つずつ（smoke は 256KB ずつ）。`--stage all --frame-analysis --nonlinear-analysis` は WebPier の手元の出力で output 8.7MB・post 137MB（JRSNAP の `.DB2` が1ケース約40MB）。`STRUCTURAL_MCP_MAX_ARTIFACT_BYTES`（128MB）には収まり、artifact の数の上限はない。遅さは実測してから（下の smoke）。

## 実物での確認（2026-10-19、smoke:webpier）

`node scripts/smoke-webpier.mjs <WebPier\pre\input.json の絶対パス> --stage <段階>`（`npm run build` の後）。MCP（`webpier_get_contract` → `webpier_validate` → `webpier_generate` → `read_artifact` で 256KB ずつ取得し SHA-256 を照合）で作ったものと、同じ venv・同じ入力ファイル・同じ runner の環境変数で `run_design.py` が作ったものをバイトで比べる。runner は server の既定（submodule の Release build。FEMPython は `engineVersion` `1.0.0+b2584ce…`、別のセッションの `sasa/nonli` の build）。

| 段階 | 時間（MCP） | engineeringStatus | 結果 |
|---|---|---|---|
| 0612 | 4秒 | ok（0612 ok） | **8ファイルすべて一致**（計算書 PDF・結果 JSON・PIK・反力 CSV・変位量 CSV と付帯JSON3つ。`implementation_sha256` も同じ venv なので一致） |
| 0610 | 3秒 | not_evaluated | 結果 JSON・FrameWeb 入力は一致。計算書 PDF（FEMPython の荷重図のページ、ADR-0005）と、その SHA-256 を記録する付帯JSONだけ違う |
| 0611 | 7秒 | not_evaluated | 結果 JSON・PIK・WDJ・CSV は一致。計算書 PDF と付帯JSON4つだけ違う。**CLI 同士でも違う**：本文は全23ページ同じで、Capacita が返すページの書体のサブセット名（`/BaseFont /SNOBBI+…`）が毎回変わる |

- smoke は、他のプログラムのページを差し込む計算書（0610・0620 の FEMPython、0611・0621・0810・0820・0910 の Capacita、0710・0720 の JRSNAP、0711・0721 の Aggre-SE）、Aggre-SE の xlsx、JRSNAP の結果フォルダーと、それらの SHA-256 を中に含む JSON を「違っても失敗にしない」に分ける（JSON の判定は、違ったファイルの SHA-256 が中に現れるか）。

## 新しいセッションからの確認（2026-10-19、完了条件6）

Codex の登録（`~/.codex/config.toml`）は変えずに、Claude Code の新しいセッションをその場限りの MCP 設定で開いた：`claude -p --strict-mcp-config --mcp-config <scratchpad>/phase4/devsession/mcp.json --allowedTools mcp__structural-mcp-dev__webpier_get_contract,mcp__structural-mcp-dev__webpier_generate < prompt.txt`（サーバー名 `structural-mcp-dev`、`node <repo>/dist/src/index.js`、`STRUCTURAL_MCP_ALLOWED_ROOTS` は `WebPier/pre`）。

1. 1回目は job root を scratchpad の深いフォルダーにしたため、`webpier_generate` が `IO_ERROR`（`…\output\output\.webpier-xzwd4uz7\.0612_線路方向基礎.pdf.70amm1tg.tmp` で No such file or directory。約264文字）。セッションのエージェントは `get_job` で原因を読み、260文字を超えていると報告した。
2. job root を浅くして2回目：`webpier_get_contract`（unavailableStages なし、4つの runner すべて available）→ `webpier_generate`（stage 0612）が ok・success・engineeringStatus ok・artifacts 8件（`0612-pdf`・`0612-json`・`0612-pik`・`0612-displacement`・`0612-reaction` と付帯JSON3つ）。
   - 2回目の設定ファイルを Git Bash の `node -e` で書き換えたら `\` が落ち、job root が `C:\Users\sasai\AppData\Localstructural-mcp-devjobs` になった（パスは短いので成功した）。このセッションで作ったそのフォルダーと空の `%LOCALAPPDATA%\structural-mcp-dev` は消した。
- → README の WebPier の節に「`STRUCTURAL_MCP_JOB_ROOT` は浅い場所に（既定で足りる）」を書いた。

## 新しく分かったこと

- Batch：`9c70f54` を Docu-SE.sln で MSBuild（VS 18 Community）して `AggreSE.Headless.exe` を作り直した（2026-10-19 21:22）。`dotnet test tests\Aggre-SE.Test\… --no-build -c Release` は **22 件すべて成功、skip 0**（この PC には `tests` の DB1 がある）。structural-mcp の `npm test`（55件）と `smoke:aggrese`（`tests/JRSNAP_Ver5.2-L03/01_サンプル(V53)：RC橋脚L：PHC/…xml`、31秒、成果物7件）も通った。
- `npm run smoke:aggrese -- <パス>` は、パスに括弧があると npm（cmd）が `^(` にエスケープして ENOENT になる。`npm run build` の後に `node scripts/smoke-aggrese.mjs <パス>` で直接呼ぶ。
- WebPier の生成で入力エラーの多くは `<入力のパス>: <理由>` の形のメッセージ（`Reader.error` と計算層の `_need` など約100か所）。`InputError` に属性を足すより、メッセージの先頭が入力のパス（最初の区切りが `parse.TOP_KEYS`）かで取り出すほうが変更が小さく、計算層のエラーにも効く。
- WebPier の項目表 `FIELDS` のパターンは `.` 区切りだが、キーに `.` を含むもの（`等価繰返し回数.A列車.k=0.06`）がある。数字だけの区切りは前のキーに戻す（`1両の長さ` のように数字で始まるキーはあるが、数字だけのキーはない）。
- 項目表にない構造の規則：空き支承枠は枠ごと `null`（`B支点`・`C支点` は10枠）、柱の `side_rows`・`band_rows` は空（帯鉄筋は `column_hoops`）、`manual_basis` は省略か `null`。schema に足し、`current.json` と `pre/input.json` が schema に合うことをテストで確かめた。
- Node の `spawn` は環境を明示しても、Windows では libuv が `USERPROFILE`・`WINDIR`・`HOMEDRIVE` などを足す（既存の runner も同じ）。
- Codex の MCP の tool 呼び出しには既定の timeout がある（`config.toml` の `tool_timeout_sec`）。静的非線形解析を含む `webpier_generate` は数分かかるので、README に `tool_timeout_sec = 1800` を書いた。
- いまの Codex の登録は `structural-mcp`（この repo の `dist/src/index.js`、`STRUCTURAL_MCP_WEBDAN_RUNNER` に `.dll`）だけで、`structural-mcp-dev` はない。release 用の登録が開発の作業ツリーを指しているので、Codex の新しいセッションでは Phase 4 の `webpier_*` がすでに見える（WebPier・JRSNAP の runner は既定のパスで検出される）。
- WebPier の job の中のパスは長い：`<job root>\<日付>\<日付>_<uuid>\output\output\.webpier-<8文字>\.<ファイル名>.<8文字>.tmp`（publication.py の一時ファイル）。JRSNAP の結果は `post\線路直角方向_JRSNAP\線路直角方向(Case1_ρm10_αf1_正向).DB2` のように長い。WebPier の Python は Windows の長いパスを使えないので、job root が深いと失敗する。

## Tips

- WebPier の生成の検査：`run_headless.py run --stage 0500` は runner がいらないので、環境変数なしで試せる（`env -u STRUCTURAL_MCP_FEMPYTHON_RUNNER .venv/Scripts/python.exe -X utf8 run_headless.py run --input pre/input.json --output-dir <scratchpad>/x --stage 0500`）。
- WebPier の pipeline 層のカバレッジだけを見る：`COVERAGE_FILE=<scratchpad>/cov/.coverage uv run … -m coverage run -m pytest tests/pipeline -q` → `coverage combine` → `coverage report --include "webpier/pipeline/*"`（約6分）。
- Git Bash の heredoc や `node -e '…'` に日本語・`\n`・`'` を含むコードを書くと崩れることがある。複数行のコードは Write ツールでファイルにする（scratchpad の `phase4/replace.mjs` は「ちょうど1回ある文字列を置き換え、CRLF を保つ」）。

## ほかの作業者へ

- structural-mcp は **push していない**（`1423773` Batch の pointer、`91d7aca` Phase 4、この記録の commit）。WebPier は `b6c349c` を push 済み。
- Phase 7（`structural-webpier` スキル）へ：MCP のツール名は `webpier_get_input_schema`・`webpier_get_contract`・`webpier_validate`・`webpier_generate`。成果物は job の `output/output/…`・`output/post/…` で、`read_artifact` で取って案件の `output/`・`post/` に置く（JRSNAP のフォルダーは中のファイルごと。`.DB2` は約40MB で、64KB ずつだと数百回の呼び出しになるので `maxBytes` を上限の 256KB にする）。`engineeringStatus` は段階ごとに見る（0611 などの Capacita の照査は not_evaluated のまま）。Codex は `tool_timeout_sec` を長くしないと非線形解析の生成が切れる。
- Phase 6（installer）へ：WebPier の runner は `run_headless.py` と横の `.venv`。server は WebPier に Capacita の `.exe`（apphost）を渡すので、payload に `WebDanforCS.Headless.exe` が要る。

- **WebPier の CLAUDE.md の「PDF は毎回同じバイト。例外は FEMPython と JRSNAP のページ」は、本物の Capacita の runner では足りない**：0611・0621（と同じ仕組みの 0810・0820・0910）の計算書は、Capacita のページの書体のサブセット名が毎回変わるのでバイトが変わる（テストは代役の runner なので出ない）。WebPier の受入や比較で 0611 の PDF のバイトを使うときは注意。WebPier の文書はまだ直していない。

- 2026-10-19 の作業中に、structural-mcp の `skills/structural-capacita/SKILL.md` に自分のものではない未コミットの変更が現れた（別のセッション）。Phase 4 の commit には含めない。
