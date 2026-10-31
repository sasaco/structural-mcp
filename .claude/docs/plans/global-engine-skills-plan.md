# 解析エンジンと WebPier を MCP とグローバルスキルで公開する計画

- 状態: Phase 0・1・2・3・4・5・7・8 完了（2026-10-19）。記録は `.claude/docs/plans/phase2-aggrese-skill-split.md`・`phase3-repository-preparation.md`・`phase4-webpier-mcp.md`・`phase5-engine-skills.md`・`phase7-structural-webpier-skill.md`・`phase8-project-cleanup.md`。Phase 6（installer）は MSI の実インストール・修復・削除の検証（`msi-lifecycle.ps1`）を除き完了（`phase6-installer.md`。この PC の Windows Installer が全 MSI で 1603 を返すため、再起動の後に行う）。§9 の3（P7橋脚 での最終確認）は利用者が別に行う
- 更新日: 2026-10-20
- 対象: `structural-mcp`（新設 `skills/`、server、installer）、WebPier（橋脚自動設計アプリ）、JRSNAPHeadless、GridLayoutPdf、K:\レールウェイコンサルタント の各案件、Batch submodule
- 対象クライアント: Codex（主）、Claude Code

## 1. 承認済み方針

1. 解析エンジン（Aggre-SE、Capacita、FEMPython、SoilStructure、JRSNAP）の知識は `structural-mcp/skills/` を唯一の正とし、ユーザー全体（グローバル）のスキルとして配る。
2. **WebPier（橋脚自動設計アプリ）を structural-mcp に加え、MCP ツールとグローバルスキルで公開する**（2026-10-19 追加）。設計案件のエージェントは、WebPier の repo を開かずに MCP から橋脚の設計計算・計算書の生成を行える。
3. スキルは次の4層に分け、置き場所を固定する。

| 層 | 内容 | 置き場所 | 例 |
|---|---|---|---|
| エンジン | 書式、項目の意味、runner の挙動、版による違い | structural-mcp `skills/structural-<engine>/`（グローバル） | Aggre-SE の XML は Shift-JIS、`_rbSpec` の添字 |
| アプリの使い方 | WebPier の入力（schema 2）の意味、段階と依存、スイッチ、成果物、失敗の読み方、見本との対応の仕方 | structural-mcp `skills/structural-webpier/`（グローバル） | 0711 を作るには `--nonlinear-analysis` と JRSNAP・Aggre-SE が要る |
| アプリの開発 | WebPier の実装、決定番号、受入スクリプト、テストの期待値、層の規則 | WebPier repo の `.claude/skills/`（WebPier を開いたときだけ） | `writer.py` の `BATCH_VERSION` を変えたら受入を取り直す |
| 案件 | その構造物の判断、発注者とのやり取り、見本の読み替え | 各案件の repo | 26_関内 の EV ピットの条件 |

4. 知見の追記先はその層の正の置き場所。インストール先のコピーは直接編集しない。

## 2. 現状（2026-10-19 調査）

### 2.1 スキルの重複

| スキル | 置き場所（コピー数） | 状態 | 移す先（§1 の層） |
|---|---|---|---|
| aggrese-project | WebPier, 26_関内 | 同一 | エンジン約7割、WebPier の開発約3割 |
| capacita-column-check | WebPier(77行), 26_関内(68行) | **食い違い** | エンジン＋WebPier の使い方（0611・0621）＋開発 |
| jrsnap-input-launch / -open-save / -soil-analysis | Batch submodule, 26_桑園, WebPier, 26_関内 | **2系統に分岐**（桑園・Batch が旧、WebPier・関内が新） | エンジン |
| jrsnap-ndu-edit | 26_桑園, WebPier, 26_関内 | **分岐**（新は見本照合の reference を追加） | エンジン＋WebPier の開発 |
| jrsnap-data-check / -load-diagram | WebPier, 26_関内 | 同一 | エンジン（決定50・51 は WebPier の開発） |
| foundation-check | WebPier, 26_関内 | 同一 | WebPier の使い方（0612・0622 の照査の中身）＋開発 |
| pier-report-style | WebPier, 26_関内 | 同一 | WebPier の開発 |
| slab-shear-summary | 26_桑園 のみ | — | 判断保留（§10） |
| jrsnap-input-launch / -open-save / -ndu-edit / -soil-analysis | 26_上越新幹線(固有周期)（K:\ニュージャパンコンサルタンツ） | 旧系統（Phase 5 で見つけた。ほかにない記述はない） | エンジン |

- `jrsnap-*` には `scripts/`（ps1・cs）と `references/` がある。SKILL.md はスクリプトを**プロジェクトのルートからのパス**（`.claude\skills\...`）で呼んでいる。
- 絶対パス（`C:\Users\sasai\Documents\...`、`C:\RTRI_Program\JRSNAP(...)`）が書かれている。
- 26_関内 には WebPier のコードがないのに、WebPier のスキル一式がコピーされている（26_関内 の CLAUDE.md も「`webpier/` の実体がない」と注意している）。K: は NAS なのでリンクが作れず、コピーで運用している。
- 汎用の開発スキル（plan、tdd、_shared など）の重複は本計画の対象外（§11）。

### 2.2 WebPier

- 別 repo（`github.com/sasaco/WebPier`）。structural-mcp の作業ツリーに git 管理外で置かれ、structural-mcp の CLAUDE.md は「無関係、無視する」としている。未コミットの変更がある。→ Phase 3 で structural-mcp の submodule にした。
- Python 3.12・uv（`uv.lock`）。CLI は `python -m webpier --stage ... [--frame-analysis] [--nonlinear-analysis] --input <json> --output-dir <dir> --post-dir <dir> --overwrite`。終了コードは 0（公開完了）、2（入力・環境のエラーで何も公開していない）、3（公開失敗・一部未復元）。入力エディタ（Tkinter）もある。
- 入力は `pre/input.json`（schema 2）。項目表は `webpier/inputs/fields.py`。
- 成果物は `output/`（計算書 PDF・結果 JSON）と `post/`（FrameWeb 入力、NDU、PIK・CSV、WDJ、Aggre-SE の XML・PIK・XLSX・CSV、JRSNAP の結果**フォルダー**、付帯JSON `*.provenance.json`）。結果 JSON に段階ごとの `engineering_status` がある（0612・0622 は ok/not_ok、断面照査は not_evaluated）。
- runner は環境変数、なければ repo のルートの `.env` から読む：`STRUCTURAL_MCP_FEMPYTHON_RUNNER`、`STRUCTURAL_MCP_WEBDAN_RUNNER`、`STRUCTURAL_MCP_AGGRESE_RUNNER`、`STRUCTURAL_MCP_JRSNAP_RUNNER`。**既定の `--stage all` でも 0710・0720 が JRSNAP の runner（figures）を要する**ので、JRSNAP なしでは 0500・0600・0610・0620 しか作れない。
- `pyproject.toml` の `gridlayoutpdf = { path = "C:/Users/sasai/Documents/GridLayoutPdf" }` が**手元の絶対パス**。GridLayoutPdf は `github.com/sasaco/grid_layout_pdf`。→ Phase 3 で git の参照（commit の SHA）にした。
- `--nonlinear-analysis` は1方向数分かかり、JRSNAP の画面が出る。server の既定のタイムアウトは 180 秒（`STRUCTURAL_MCP_TIMEOUT_MS`）。
- 帳票に Windows の書体（MS明朝・MSゴシック・Calibri・Times Italic）が必須。

### 2.3 JRSNAPHeadless

- structural-mcp の作業ツリーにある、git 管理外の別 repo。**リモートなし**。`config.ts` に未登録で、MCP のツールもない。WebPier だけが直接呼んでいる。→ Phase 3 で GitHub の private repo（`sasaco/JRSNAPHeadless`）を作り、structural-mcp の submodule にした。
- JRSNAP 本体（鉄道総研、ライセンス品）は利用者が別に入れる。インストール先は runner の横の `jrsnap-headless.json` に書く。

## 3. 目標の構成

```
structural-mcp/
  FEMPython/ Capacita/ SoilStructure/ Batch/     （既存の submodule）
  WebPier/                                       submodule（新規。github.com/sasaco/WebPier）
  JRSNAPHeadless/                                submodule（新規。リモートを作る）
  skills/
    README.md                     層の分け方・書き方・追記の規則
    structural-aggrese/           SKILL.md + references/ + scripts/
    structural-capacita/
    structural-jrsnap-input/      jrsnap-input-launch + jrsnap-input-open-save + JRSNAPHeadless
    structural-jrsnap-ndu/
    structural-jrsnap-figures/    jrsnap-data-check + jrsnap-load-diagram
    structural-jrsnap-soil/
    structural-fempython/         必要と分かった場合だけ（Phase 5）
    structural-soilstructure/     同上
    structural-webpier/           橋脚自動設計アプリの使い方
      SKILL.md                    何ができるか、MCP での流れ、段階とスイッチの選び方
      references/
        input-schema2.md          入力項目の意味（fields.py・CONTEXT.md から。単位・桁・選択肢）
        stages.md                 段階・依存・必要な runner・成果物の表
        checks.md                 0611/0612/0621/0622/0800–0910 の照査の中身（foundation-check などの利用者向けの部分）
        outputs.md                計算書・post の各ファイルの意味、付帯JSONで新旧を確かめる方法
        troubleshooting.md        終了コード 2・3、runner なし、入力エラーの読み方
  src/                            WebPier のツールを追加（§5）
  scripts/install-skills.mjs
  tests/skills.test.ts
```

スキルの書き方（全スキル共通）：

- 名前は `structural-` で揃える。
- スクリプトは**スキルのフォルダーからの相対パス**で書く。
- runner の場所は環境変数か MCP の `get_capabilities`／`get_environment_template` で調べる。ソースを読む手順は「開発機のみ。structural-mcp の repo のルートから」と明記する。見本データの絶対パスは書かない。
- MCP ツールがある操作は MCP を先に案内し、runner・CLI を直接呼ぶ方法はスクリプトから使う場合の手段として書く。
- 各事実に「コードで確認／実アプリで確認／推定」と確認した版を残す。
- SKILL.md は 200 行以内を目安にし、詳細は `references/` に置く。

## 4. スキルの配り方

### 4.1 配置先

| クライアント | 配置先 | 備考 |
|---|---|---|
| Claude Code | `%USERPROFILE%\.claude\skills\structural-*` | `synced/` は使わない。Claude Code は `~/.agents/skills` を読まない（Phase 0） |
| Codex | `%USERPROFILE%\.agents\skills\structural-*` | Codex 0.163.0 は `~/.agents/skills` と `~/.codex/skills` の両方を読む（Phase 0）。両方に置くと重複するので `~/.agents/skills` だけにする |

- 両クライアントともジャンクションを辿る（Phase 0）。
- **SKILL.md は BOM なしの UTF-8 で書く**。BOM が付くと Codex はスキルを一覧に出さない（Claude Code は読む。Phase 0）。Windows PowerShell 5.1 の `Set-Content -Encoding utf8` は BOM を付けるので使わない。
- 同じ名前のスキルが案件にもあると、Claude Code はユーザー全体のほうを使い、Codex は両方を一覧に出す（Phase 0）。案件側で `structural-*` の名前を使わない。

配置先は C: のユーザーフォルダーなので、K:（NAS）でリンクが作れない問題は起きない。

### 4.2 開発機（`npm run skills:install`）

- `scripts/install-skills.mjs install --mode link`：`skills/structural-*` ごとに**ディレクトリジャンクション**（管理者権限不要）を作る。repo を直せば全案件に即時反映される。
- `--mode copy`：ジャンクションを辿らないクライアント向けの予備。
- `status`：配置先ごとに「ジャンクション（リンク先）／コピー（差の有無）／なし／同名の他人のスキル」を表示する。
- `uninstall`：受領記録（`.structural-mcp/skills-install-state.json`）にあるものだけを消す。同名の他人のフォルダーがあれば上書きせず停止する。

### 4.3 MSI の利用者

- payload に `skills/` を含め、`setup.cmd` が Codex 登録と同じ流れで**コピー**する。受領記録を残し、unregister とアンインストールで自分の配置だけを消す。`health.cmd` で SHA-256 を照合する。`--no-skills` で省略できる。

## 5. WebPier の MCP 化

### 5.1 runner の契約（WebPier 側に追加）

structural-mcp の他のエンジンと同じ protocol v1 の runner として呼べる入口を、WebPier の pipeline 層に加える（`webpier/pipeline/headless.py`）。起動用に repo のルートに `run_headless.py`（`run_design.py` と同じ薄いスクリプト）を置き、structural-mcp はこのファイルを runner として起動する（Phase 0 の3）。既存の CLI と生成の仕組み（`generate.py`、`publication.py`）はそのまま使う。

```text
run --input <schema 2 の JSON> --output-dir <空のフォルダー>
    [--stage <段階|all>] [--frame-analysis true|false] [--nonlinear-analysis true|false]
validate --input <JSON> --output-dir <空のフォルダー>          入力の解析・検証だけ（計算書を描かない）
```

- `--output-dir` の下に `output/` と `post/` を作り、既存の CLI と同じ配置で書く（`--overwrite` は不要。出力先は常に空）。
- stdout は envelope 1つ：`engine: "webpier"`、`ok`、`summary`（実行した段階、各段階の `engineering_status`、使った runner の版、入力の SHA256）、`artifacts`（全ファイルの相対パス・kind・SHA-256・サイズ。JRSNAP の結果フォルダーは中のファイルを個別に列挙する）、`messages`（入力エラーは項目のパス付き）。
- 終了コードの対応：0→`ok: true`、2→`ok: false`（`INPUT_ERROR`／`RUNNER_UNAVAILABLE`／`ENGINE_FAILED` を区別）、3 は MCP の出力先が常に空なので起きない想定（起きたら `ok: false`）。
- `.env` は読まない（runner の場所は呼び出し側の環境変数だけ。いまも環境変数が優先なので、headless では `.env` の読込みを止めるだけでよい）。
- 段階の一覧・依存・必要な runner を返す `contract` コマンドも加え、MCP の静的な契約に使う（`stages.py` の `StageSpec` から作り、手で書かない）。
- 入力の JSON Schema を `fields.py` の項目表から出す `schema` コマンド（`soilstructure_get_schema` と同じ役割）。

### 5.2 structural-mcp 側

| 変更 | 内容 |
|---|---|
| `config.ts` | `STRUCTURAL_MCP_WEBPIER_RUNNER`（既定 `WebPier/run_headless.py`）と `STRUCTURAL_MCP_JRSNAP_RUNNER`（既定 `JRSNAPHeadless/bin/Release/JRSNAP.Headless.exe`）を独立に検出する。WebPier は `run_headless.py` と横の `.venv\Scripts\python.exe` の両方があるときだけ使える |
| `runner.ts` | runner のパスが `.py` で終わるときは、スクリプトと同じフォルダーの `.venv\Scripts\python.exe -X utf8 <script>` で起動する（`.mjs`→node、`.dll`→dotnet と同じ扱い。Phase 0 で最小の環境で動くことを確認済み）。WebPier の runner には最小の環境に加えて、server が検出した4つの runner のパス（`STRUCTURAL_MCP_*_RUNNER`）だけを渡す |
| `server.ts` | `webpier_get_input_schema`、`webpier_get_contract`（段階・依存・必要な runner、いまの環境でどの段階が使えるか）、`webpier_validate`、`webpier_generate`（`stage`・`frameAnalysis`・`nonlinearAnalysis`）。入力は既存の `inputPath`／inline `input`（JSON オブジェクト）。`engineeringStatus` は段階ごとの値を集約（1つでも not_ok なら not_ok、判定しない段階だけなら not_evaluated） |
| タイムアウト | `CalculationSpec` ごとのタイムアウトを持てるようにし、`webpier_generate` は `nonlinearAnalysis` のとき長くする（新しい環境変数 `STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS`、既定 30 分） |
| 同時実行 | JRSNAP は同じインストール先で同時に解析できない（JRSNAPHeadless が mutex で直列にする）。server 側では追加しない |
| `contracts.ts` | `JobManifest.tool` と engine に webpier を追加 |
| `get_capabilities`・`get_environment_template` | webpier と jrsnap を追加。WebPier は「依存する runner が欠けると使えない段階」を返す |
| テスト | `tests/fixtures/fake-webpier-runner.mjs`（envelope と output/post の成果物を返す代役）、`tests/mcp.test.ts` にツール一覧とシナリオ（生成、入力エラー、依存 runner なしで段階が使えない） |
| README.md・CLAUDE.md | ツール表、環境変数、「WebPier は無関係」の記述を削除して submodule として説明 |

成果物を案件の `output/`・`post/` に置くのは、既存の原則どおりクライアントの役目（`read_artifact` でバイトと SHA-256 を確かめてから書く）。ファイル数が多い（`--stage all --frame-analysis --nonlinear-analysis` で数十ファイル＋JRSNAP の結果フォルダー）ので、`structural-webpier` スキルに「envelope の artifacts を順に取得して `output/`・`post/` に置く」手順と Python の補助スクリプトを入れる。zip でまとめて返す方式は、実際に遅いと分かってから検討する。

JRSNAPHeadless 単体の MCP ツール（`jrsnap_run`、`jrsnap_figures`）は WebPier の公開には不要なので、本計画では `config.ts` での検出と WebPier への受け渡しまでにする（§10）。

### 5.3 リポジトリの準備

1. **GridLayoutPdf**：WebPier の `pyproject.toml` の `path` を git の参照（`{ git = "https://github.com/sasaco/grid_layout_pdf", rev = "<commit>" }`）に変え、`uv.lock` を作り直す。手元で GridLayoutPdf を直しながら使う場合の手順（`uv sync --reinstall-package` か一時的な path 指定）を WebPier の CLAUDE.md に残す。`dependency_hashes` が GridLayoutPdf のバイトをハッシュしているので、受入記録の取り直しが要るかを確かめる。
2. **JRSNAPHeadless**：GitHub に private のリモートを作って push し、structural-mcp に submodule として登録する。
3. **WebPier**：未コミットの変更を WebPier 側で commit・push してから、structural-mcp に submodule として登録する（作業ツリーの既存の repo をそのまま使う）。

いずれも外部への push と submodule の登録を伴うので、各手順の前に確認する。

## 6. 段階

### ✅ Phase 0：確認（半日）

1. Codex がユーザー単位のスキルを読む場所と、ジャンクションを辿るかを、テスト用スキル1つで確かめる。
2. Claude Code が `~/.claude/skills` のジャンクションを辿ること、案件に同名のスキルがあるときにどちらが優先されるかを確かめる。
3. Node の `spawn`（`shell: false`）で、WebPier の venv の python から `-m webpier --stage 0500` が動くこと、最小の環境（PATH・SystemRoot・TEMP・TMP）で uv の venv と書体が見つかることを確かめる。
4. `STRUCTURAL_MCP_ALLOWED_ROOTS` に `K:\ニュージャパンコンサルタンツ` を入れ、`K:\...\P7橋脚` の下のファイルを `inputPath` で渡したときに包含判定が通るか（realpath が `\\sasaco-ds218\...` の UNC で返る場合を含む）を確かめる。通らなければ `jobs.ts: resolveInputPath` を直す項目を Phase 4 に加える。

完了条件：両クライアントがジャンクションのスキルを読める（読めなければ copy）。WebPier が最小の環境で 0500 を生成できる。K: の入力を MCP に渡せる。

**結果（2026-10-19、完了）**

1. Codex 0.163.0（`codex exec`）：`~/.agents/skills` と `~/.codex/skills` の両方を読み、どちらでもジャンクションを辿る。最初の試行ではテスト用スキルが出なかったが、原因は PowerShell 5.1 が付けた BOM だった（BOM を除くと出た）。→ §4.1。
2. Claude Code 2.1.303（`claude -p`）：`~/.claude/skills` のジャンクションを辿る。`~/.agents/skills` は読まない。案件の `.claude/skills` に同じ名前があるとユーザー全体のほうを使う。Codex は案件の `.agents/skills` と同じ名前を両方並べる。→ §4.1。
3. WebPier：structural-mcp の `runEngine` と同じ最小の環境（PATH・SystemRoot・DOTNET_ROOT・TEMP・TMP、`shell: false`、cwd は無関係な一時フォルダー）で、`WebPier\.venv\Scripts\python.exe -X utf8 WebPier\run_design.py --stage 0500 ...` が 1.6 秒で成功した。PDF・JSON は通常の `uv run ... python -m webpier` で作ったものと SHA-256 が一致した。WebPier は `uv.tool.package = false` で venv に入っていないため、**repo のルートにあるスクリプト**として起動すること（スクリプトのフォルダーが `sys.path` の先頭になり `import webpier` が通る）。→ §5.1・§5.2。
4. K:（NAS）：Node の `fs/promises.realpath` は `K:\...` を `\\sasaco-ds218\E6-14-D8\data\...` の UNC に解決する。`config.ts` の許可ルートと `jobs.ts: resolveInputPath` の入力が同じ関数で解決されるので、`STRUCTURAL_MCP_ALLOWED_ROOTS=K:\ニュージャパンコンサルタンツ` で配下の入力は通り、`K:\レールウェイコンサルタント\...` は拒否された（ビルド済みの `dist/src/jobs.js` で確認）。**修正は不要**。

ほかに気づいたこと：`~/.codex/config.toml` の `model = "gpt-6-astra"` は、ChatGPT アカウントの `codex exec` で「not supported」と 400 になった（試験は `-m gpt-6-luna` で実施）。

### ✅ Phase 1：スキルの土台

1. `skills/README.md`（§1 の4層、§3 の書き方、§7 の追記の規則）。
2. `scripts/install-skills.mjs` と npm scripts（`skills:install`・`skills:status`・`skills:uninstall`）。
3. `tests/skills.test.ts`（`npm test` に含める）：BOM がないこと（Codex が読まないため）、frontmatter、`name` とフォルダー名の一致、`description` 1024 文字以内、相対リンク・`scripts/`・`references/` の参照先の実在、禁止パターン（`C:\Users\<名前>`、`K:\`、`.claude\skills\`・`.agents\skills\` から始まるパス、`synced`）、install の link／copy／uninstall／衝突時の停止。
4. CLAUDE.md の計画書の置き場所（`.agents/docs/plans/`）を `.claude/docs/plans/` に直す。

### ✅ Phase 2：Aggre-SE（最初の1本、型を決める）

1. `aggrese-project` を `structural-aggrese`（エンジン）と WebPier の開発用スキル `webpier-aggrese`（決定49・56〜58、受入、post の出力を作る・確かめる手順）に分ける。WebPier の使い方に当たる部分（0711・0721 の成果物の意味）は Phase 7 で `structural-webpier/references/outputs.md` へ移す。
2. `aggrese_project_roundtrip.cs` はエンジンの道具なので `skills/structural-aggrese/scripts/` へ移し、WebPier はそれを参照する（WebPier の `.gitattributes` と受入記録の helpers の SHA に影響するので、移すか参照のままかをここで決める）。
3. `npm run skills:install`。26_関内 と WebPier の新しいセッションで `structural-aggrese` が選ばれることを確かめる。

**結果（2026-10-19、完了）**：`skills/structural-aggrese/`（SKILL.md、`references/` の project-xml・outputs・foundation-steps、`scripts/aggrese_project_roundtrip.cs` の複製）と、WebPier の `webpier-aggrese`（`aggrese-project` を改名して WebPier の実装・決定・受入だけに絞った）。元の箇条ごとの移し先の対応表、型として決めたこと、確認の結果は `phase2-aggrese-skill-split.md`。Phase 7 で `structural-webpier/references/outputs.md` へ移す候補（0711・0721 の post のファイルの意味）は、いまは `webpier-aggrese` にある。

### ✅ Phase 3：リポジトリの準備（§5.3）

GridLayoutPdf の参照 → JRSNAPHeadless のリモートと submodule → WebPier の submodule の順。完了条件：別の場所に clone した structural-mcp で `git submodule update --init --recursive` と WebPier の `uv sync --locked` が通る。

**結果（2026-10-19、完了）**：WebPier の `pyproject.toml` の GridLayoutPdf を `{ git = "https://github.com/sasaco/grid_layout_pdf", rev = "a8c52284…" }`（完全な SHA。いまの `origin/main`）にして `uv.lock` を作り直した（WebPier `f4aabca`、push 済み）。品質ゲートは変更の前後とも 3714 件通過し、受入のテスト（生成物のバイトの照合）も通ったので**受入記録の取り直しは不要**。ただし uv の git の取り出しが `core.autocrlf` に従ってインストールされるファイルの改行が変わり、`implementation_sha256` は変わる（照合はしていない）。手元の GridLayoutPdf を試す手順（`uv pip install` と `uv run --no-sync`。`--locked` の実行は lock の版に戻す）と取り込む手順を WebPier の CLAUDE.md に書いた。JRSNAPHeadless は追跡ファイルに JRSNAP 本体（DLL・exe・逆コンパイルしたソース）が履歴を含めてないことを確かめてから、GitHub の private repo `sasaco/JRSNAPHeadless` を作って push した。2つとも作業ツリーの既存の repo のまま submodule に登録し（`.git` は動かしていない）、CLAUDE.md・README を直した（structural-mcp `e1f65e8`、push はしていない）。別の場所に clone して `git submodule update --init --recursive`（深いフォルダーでは `-c core.longpaths=true` が要る）と WebPier の `uv sync --locked` が通り、clone と元の作業ツリーで 0500 の PDF のバイトが一致した。Batch（GitLab）はこの PC では認証なしで取れた。詳細は `phase3-repository-preparation.md`。

### ✅ Phase 4：WebPier の runner と MCP ツール（§5.1・§5.2）

0. **Batch の pointer を `9c70f54` 以降に進める**（Batch submodule の中で sasa/dev の commit を確かめ、MSBuild で build し、`Batch/tests/Aggre-SE.Test` を通してから）。いま固定している `47d1654` の runner は `--foundation-steps` を知らず `INVALID_ARGUMENT`（Unknown option）で止まるので、WebPier の 0711・0721（常に `--foundation-steps true` を付ける）が固定版の runner では動かない。MSI（Phase 6）も固定版から作るので、Phase 6 より前に必須。
1. WebPier に `webpier/headless.py`（run・validate・contract・schema）とテスト。層の規則（pipeline 層）と品質ゲート（pipeline 100%）を守る。WebPier 側で commit。
2. structural-mcp に config・runner・server・contracts・テストの変更。submodule の pointer を更新。
3. 実物での確認：`npm run smoke:webpier -- <input.json> [--frame-analysis] [--nonlinear-analysis]`（新設）で、CLI で作った `output/` と MCP で作ったもののうち、決定的な PDF・JSON のバイトが一致すること（差し込みページを含む PDF と、毎回変わる帳票は除く）。

**結果（2026-10-19、完了）**：Batch の pointer を `9c70f54` に進めた（MSBuild の build、Aggre-SE.Test 22件 skip なし、npm test、smoke:aggrese。structural-mcp `1423773`）。WebPier に headless runner を加えた（WebPier の決定61、`webpier/pipeline/headless.py` と `run_headless.py`、`b6c349c`、push 済み、品質ゲート 3762 件・pipeline 100%）：`run`・`validate`・`contract`・`schema`、runner は環境変数だけ（欠けていれば `RUNNER_UNAVAILABLE`、`.env` を読まない）、artifacts の kind は役割の `.` を `-` にしたもの（`0612-pdf`。JRSNAP の結果フォルダーは中のファイルを1つずつ）、入力エラーは項目のパス付き、engineeringStatus は段階ごとと全体（not_ok が1つでもあれば not_ok、判定した段階がすべて ok なら ok、なければ not_evaluated）。structural-mcp に `webpier_get_input_schema`・`webpier_get_contract`（いまの環境で生成できる選択を足す）・`webpier_validate`・`webpier_generate`、`STRUCTURAL_MCP_WEBPIER_RUNNER`・`STRUCTURAL_MCP_JRSNAP_RUNNER`・`STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS` を加えた（`91d7aca`、npm test 61件、push はしていない）。`.py` の runner は横の `.venv\Scripts\python.exe -X utf8` で起動し、WebPier には検出した runner のパスだけを渡す（Capacita の `.dll` は横の `.exe`）。入力は名前とバイトのまま job にコピーする（WebPier が入力名と SHA-256 を記録するため）。smoke:webpier で 0612 を MCP と CLI（同じ venv）で作り、**8ファイルすべてバイトが一致**した。0610・0611 は、差し込みページを含む PDF とその SHA-256 を記録する付帯JSONだけが違う（0611 の Capacita のページは書体のサブセット名が毎回変わり、CLI 同士でも違う）。Claude Code の新しいセッション（`claude -p --strict-mcp-config --mcp-config`、`structural-mcp-dev` の名前で、登録は変えずに）から `webpier_get_contract` と `webpier_generate`（0612）を呼べた。job root が深いと WebPier の一時ファイルのパスが 260 文字を超えて `IO_ERROR` になる（README に記載）。`--nonlinear-analysis` の実物は動かしていない（利用者の判断）。installer は Phase 6。詳細は `phase4-webpier-mcp.md`。

### ✅ Phase 5：JRSNAP・Capacita・FEMPython・SoilStructure のスキル

1. JRSNAP：4つのコピーの差分を取り、新系統（WebPier・26_関内）を基準に旧系統にしかない記述を併合する。§3 の4本に再編し、WebPier の決定番号（47・50・51）は WebPier の開発用スキルへ移す。`example-pier2-seismic-verification.md` は WebPier の開発用、`sect-frange-jiku.md`・`section-material-geometry-rebar.md` はグローバルへ移す。
2. Capacita：`capacita-column-check` の2版を併合してから3つに分ける。エンジン（WDJ、`run-rc --pickup`、reportSections、WD-1901〜1908・WD-9999）は `structural-capacita`、0611・0621 の利用者向けの説明は `structural-webpier/references/checks.md`、決定48と実装は WebPier の開発用。
3. FEMPython・SoilStructure：MCP のツール説明と README で足りているかを、案件のセッションでの使われ方を見て判断し、足りない場合だけ作る。

**結果（2026-10-19、完了）**：`structural-jrsnap-input`・`-figures`・`-ndu`・`-soil` と `structural-capacita`。WebPier は `webpier-jrsnap`（新規）と `webpier-capacita`（`capacita-column-check` を改名）にし、WebPier の `jrsnap-*` は前倒しで消した（受入の補助 `jrsnap-input-open-save/scripts/` は残す）。FEMPython・SoilStructure は作らない（どの案件にもエンジンの知識を持つスキルがなく、MCP のツール説明と契約で足りている）。26_桑園 の案件の記録はグローバルに入れず、桑園のコピーに残した。詳細・判断待ち（フーチングの WDJ の La の単位）は `phase5-engine-skills.md`。

**追記（2026-10-30、owner の決定）**：FEMPython のスキル `structural-fempython` を作った。WebPier と WebRamen が FrameWeb の入力を書き、本物の FEMPython で確かめた規約（符号、部材荷重のマーク、ばねの組、define・combine・pickup、中身のない荷重ケースの PICKUP_UNAVAILABLE、周面ばねの反力）が両方の repo に散らばっていたため。SoilStructure は作らないまま。

### Phase 6：installer

1. `build-installer.ps1`：`skills/`、WebPier（uv の lock から作る配布物。FEMPython と同じオンライン bootstrap）、JRSNAPHeadless の runner を payload に含める。`payload.mjs` の provenance に加える。
2. `runtime/launcher.mjs`：WebPier の Python 環境の構築、スキルの配置、JRSNAP のインストール先の検出（`C:\RTRI_Program\JRSNAP(...)` を探し、`jrsnap-headless.json` を書く。見つからなければ WebPier の 0710 以降と JRSNAP の段階だけを無効にして、ほかは使えるようにする）、unregister・アンインストールでの解除、`health.cmd` での検査。
3. `installer/tests/runtime.test.mjs`、`verify/payload-smoke.mjs`（WebPier の 0500〜0620 を実計算。JRSNAP があれば `--jrsnap` 指定時だけ 0710 以降も）、`installer/README.md`。
4. 再頒布の確認：JRSNAP 本体は同梱しない（利用者が入れる）。JRSNAPHeadless が JRSNAP の DLL を同梱していないことを確かめる。

**結果（2026-10-20、MSI の実インストールの検証を除き完了）**：利用者の判断で2点を変えた。(1) git のない PC では WebPier の `uv sync --locked` が GridLayoutPdf（git の参照）で止まると分かったので、`sasaco/grid_layout_pdf` に Release `v0.1.0`（`a8c5228` の wheel、`SOURCE_DATE_EPOCH` で同じバイト）を作り、WebPier の参照をその wheel の URL にした（WebPier `78654a2`、品質ゲート 3762 件、push 済み）。(2) JRSNAPHeadless（private repo）は MSI に**入れない**。JRSNAP の検出と `jrsnap-headless.json` の書出しは作らず、MSI では WebPier の 0710 以降は使えない（`webpier_get_contract` が `missingRunners: ["jrsnap"]` を返す）。payload に `engines/WebPier`（`run_headless.py`・`webpier/`・`uv.lock` など）と `skills/structural-*` を入れ、setup が FrameWeb と同じ `uv sync --locked` で WebPier の `.venv` を作り、スキルを `~/.claude/skills`・`~/.agents/skills` にコピーする（`installer/runtime/skills.mjs`。ファイルごとの SHA-256 の受領記録、同名の他人のスキル・リンクや編集されたコピーがあれば Codex の登録の前に何も変えずに止まる、`--no-skills`、`--replace-existing` で前の版の変更のないコピーを引き継ぐ）。unregister・アンインストールは自分が置いて変更のないコピーだけを消し、health は SHA-256 を照合する。登録に `STRUCTURAL_MCP_WEBPIER_RUNNER` と `tool_timeout_sec = 1800`。installer のテスト 34 件・npm test 66 件。`-Preview` の MSI を作り、`payload-smoke.mjs --initialize --relocate`（PATH は System32 だけ）で 0500〜0622 を1段階ずつ実計算、スキルの配置と解除も通った。`msi-lifecycle.ps1` は、この PC の Windows Installer が旧 MSI の管理用の展開を含め全 MSI で即 1603 を返すため未完（サービスか PC の再起動の後にやり直す）。詳細は `phase6-installer.md`。

### ✅ Phase 7：`structural-webpier` スキル

1. SKILL.md：何を作るアプリか（0500〜0910 の段階）、MCP での流れ（`webpier_get_contract` で使える段階を確かめる → 入力を作る／直す → `webpier_validate` → `webpier_generate` → 成果物を `output/`・`post/` に置く）、スイッチの選び方、入力エディタ（GUI）の起動方法、判定（engineering_status）と実行の成否を混同しないこと。
2. references/：§3 のとおり。WebPier の README・CONTEXT.md・`fields.py` を正とし、要約とそこへの参照にとどめる（二重管理を避けるため、項目の一覧は `webpier_get_input_schema` で取れるようにして、スキルには意味の説明だけを書く）。
3. `foundation-check`・`capacita-column-check`・`aggrese-project` のうち、利用者向けの部分（照査の式と見本との対応、成果物の意味）をここへ移す。
4. 最終確認（§9 の3）：`K:\ニュージャパンコンサルタンツ\26_LRT鉄道照査\P7橋脚` で新しいセッションを開き（WebPier の repo は開かない）、「線路方向の基礎の照査まで作って」と頼む。MCP 経由で 0612 の計算書が `P7橋脚\output\` に置かれることを確かめる。
   - P7橋脚 は 2026-10-19 時点で空のフォルダー。親の repo（`26_LRT鉄道照査`、GitLab `njc_26_lrt`）に案件のスキルはないので、**グローバルのスキルだけ**で進められるかの確認になる。
   - schema 2 の入力（`P7橋脚\pre\input.json`）はまだない。発注者の資料（`NJC→ささこう`）から入力を作るところも、`structural-webpier` と `webpier_get_input_schema`・`webpier_validate` で進められることを含めて確かめる。入力値が資料から決まらない項目は利用者に聞く（推測で埋めない）。
   - 0612 は 0500・0610 と骨組解析（FEMPython）に依存する。JRSNAP・Aggre-SE は要らない。
   - K: は NAS（実体は `\\sasaco-ds218\...`）。`STRUCTURAL_MCP_ALLOWED_ROOTS` に入れた `K:\...` と、入力の realpath が UNC で返る場合の包含判定が一致するかを Phase 0 で確かめる。

**結果（2026-10-19、完了）**：`skills/structural-webpier/` を作った（structural-mcp `df4b395`）。SKILL.md（MCP での流れ、段階とスイッチの選び方、成果物を置く、入力エディタ、runner を直接呼ぶ方法）と references（`input-schema2.md`・`stages.md`・`checks.md`・`outputs.md`・`troubleshooting.md`）。段階の表は WebPier の `run_headless.py contract` の出力から写し、項目の一覧は書かずに `webpier_get_input_schema` を正とした。3（WebPier の開発用スキルの利用者向けの部分）は `checks.md` に移した（WebPier 側から消すのは Phase 8）。成果物の受け渡しは §5.2 の「`read_artifact` で1つずつ」から変え、job の `manifest.json` のバイト数と SHA-256 を確かめて案件の `output/`・`post/` に複写する Node のスクリプト `scripts/place-webpier-outputs.mjs` を付けた（計算書は1つ最大 2MB、JRSNAP の結果は数十MB で、Base64 で文脈に通せないため。server は `get_capabilities` の `pathPolicy.jobRoot` を返すようにした）。`npm test` 66件、`npm run skills:install`、Claude Code と Codex の新しいセッションで `structural-webpier` が選ばれ、0612・FEMPython・スクリプトでの配置と正しく答えた。4（P7橋脚 での最終確認）は利用者の判断で Phase 7 から外し、§9 の3 の確認として利用者が別に行う（手順は `phase7-structural-webpier-skill.md`）。

### ✅ Phase 8：各プロジェクトの片付け

ファイルを消す作業なので、各 repo で差分を確認してから行う。

| プロジェクト | 消す | 残す |
|---|---|---|
| WebPier | （`jrsnap-*`・`aggrese-project`・`capacita-column-check` は Phase 2・5 で済み）`foundation-check`・`webpier-capacita` のうち使い方の部分（Phase 7 で `structural-webpier` へ）→ 使い方だけの節はなく、削らずに参照を足した | 開発用：`webpier-aggrese`、`webpier-capacita`、`webpier-foundation`（実装と受入）、`webpier-footing`、`webpier-cantilever`、`webpier-jrsnap`、`pier-report-style`、汎用スキル |
| 26_関内 | `jrsnap-*`、`aggrese-project`、`capacita-column-check`、`foundation-check`、`pier-report-style` | 案件固有のもの |
| 26_桑園高架橋 | `jrsnap-*`（4本。消す前に `jrsnap-ndu-edit` の L3 などの記録と総括表の転記の規則を案件のスキルへ移す） | `slab-shear-summary`（§10） |
| 26_上越新幹線(固有周期) | `jrsnap-*`（4本） | `geology-column-log-*` |
| Batch submodule | `.claude/skills/jrsnap-*`（3本） | なし（submodule 内で commit し、pointer を更新） |

各案件の CLAUDE.md・AGENTS.md に「解析エンジンと WebPier の知識は `structural-*` のグローバルスキルにある。エンジン・WebPier の新しい知見は structural-mcp の `skills/` に書く」と1行加える。26_関内 の CLAUDE.md の「WebPier 由来のスキルは実体がない」という注意は削除する。

**結果（2026-10-19、完了）**：各コピーを Phase 5 で基準にした WebPier の版と改行を除いて比べ、グローバルの `structural-*` に無い記述は 26_桑園高架橋 の案件の記録（`jrsnap-ndu-edit` の references 2つ）だけと確かめた。それを内容を変えずに桑園の `slab-shear-summary/references/ndu-*.md` へ移してから、26_関内 の10本（`jrsnap-*` 6本・`aggrese-project`・`capacita-column-check`・`foundation-check`・`pier-report-style`、関内 `6861bbc`）、26_桑園高架橋 の `.agents/skills/jrsnap-*` 4本（`512cad2`）、26_上越新幹線(固有周期) の `jrsnap-*` 4本（`1ad5d30`）、Batch の `.claude/skills/jrsnap-*` 3本（Batch `c15b3c4`、sasa/dev、push 済み）を消した。関内 CLAUDE.md・AGENTS.md と桑園 AGENTS.md に知識の置き場を書き、関内の古い注意を消した（上越には CLAUDE.md・AGENTS.md がなく、利用者の判断で作らない）。WebPier の開発用スキルは、使い方だけの節がなかったので削らず、structural-webpier への参照を足し、§10 のとおり `foundation-check`・`footing-check`・`cantilever-check` を `webpier-foundation`・`webpier-footing`・`webpier-cantilever` に改名した（WebPier `2652cad`、push 済み。スキルのファイルだけで品質ゲートは不要）。structural-mcp は Batch・WebPier の pointer と checks.md の名前を更新し、`npm test` 66件成功。Claude Code と Codex の新しいセッションで、26_関内・26_桑園高架橋・WebPier のどこからも同じ `structural-*` 7本が読まれ、消したスキルが一覧に出ないことを確かめた（§9 の2・4）。案件の repo の commit は push していない。`jrsnap-operator`（JRSNAP の操作説明書の PDF、スキルではない）は利用者の判断で残した。詳細は `phase8-project-cleanup.md`。

## 7. 知見の追記の規則（各 SKILL.md の末尾に入れる文）

- エンジンの性質・WebPier の使い方 → structural-mcp の `skills/structural-*/` を編集する。開発機ではジャンクションなので repo の作業ツリーが変わる。commit は structural-mcp で行う。
- WebPier の実装・決定・受入 → WebPier の `.claude/skills/` か `refactoring-decisions.md`。
- 案件の判断・見本の読み替え → その案件の repo。
- MSI の利用者の環境ではスキルはコピーなので編集しない。知見は案件側に書き、開発者に報告する。

## 8. 順序と依存

```
Phase 0 ─┬─ Phase 1 ── Phase 2 ── Phase 5 ─┐
         └─ Phase 3 ── Phase 4 ──────────── Phase 7 ── Phase 8 ── Phase 6
```

- スキル（1・2・5）と WebPier の MCP 化（3・4）は並行できる。
- `structural-webpier`（7）は MCP のツール名が決まってから書く。
- installer（6）は最後。payload の中身（skills、WebPier、JRSNAPHeadless）がそろってから一度に入れる。

## 9. 完了条件

1. `structural-*` のスキルが structural-mcp の `skills/` だけにあり、`npm test` の静的検査が通る。
2. 開発機の Claude Code と Codex の新しいセッションで、26_関内・26_桑園高架橋・WebPier のどこから開いても、同じ `structural-*` が読み込まれる。
3. `K:\ニュージャパンコンサルタンツ\26_LRT鉄道照査\P7橋脚` の新しいセッション（WebPier の repo を開かない）で「線路方向の基礎の照査まで作って」と頼むと、MCP の `webpier_generate` 経由で 0612 の計算書が `P7橋脚\output\` に置かれる（Phase 7 の4）。決定的な成果物は CLI で作ったものとバイトが一致する。
4. 各プロジェクトに、エンジン・WebPier の知識を重複して持つスキルが残っていない。
5. MSI のセットアップで WebPier・JRSNAPHeadless・スキルが使えるようになり、JRSNAP がない PC でも 0500〜0620 は動く。アンインストールで消え、他人のスキルを上書きしない。（2026-10-19、利用者の判断で JRSNAPHeadless は MSI に入れない。Phase 6 の結果を参照）

## 10. 決定事項（2026-10-19、すべて推奨どおり）

- **Python の runner の起動方法**：`.py` の runner を、その project の `.venv\Scripts\python.exe` で起動する（`uv run` は使わない）。Phase 0 で最小の環境で動かないと分かった場合だけ見直す。
- **JRSNAPHeadless のリモート**：GitHub に private で作る（Phase 3）。
- **WebPier の開発用スキル名**：`webpier-*` に改名する（`webpier-aggrese`、`webpier-capacita`、`webpier-foundation`）。Phase 8 で、後から加わった `footing-check`・`cantilever-check` も `webpier-footing`・`webpier-cantilever` にした（2026-10-19、利用者）。
- **slab-shear-summary**：今回は移さない（26_桑園高架橋 に残す）。2つ目の案件で使うときに、参考資料の PDF の再頒布の可否を確かめてから判断する。
- **JRSNAPHeadless 単体の MCP ツール**：今回は作らない。`config.ts` での検出と WebPier への受け渡しまで。
- **WebPier の入力の受け渡し**：inline の JSON と `inputPath` の両方を受ける。案件の `pre/input.json` を `inputPath` で渡すのを主な使い方とする。

- **`aggrese_project_roundtrip.cs`（Phase 2）**：移さずに**複製**を `skills/structural-aggrese/scripts/` に置く。WebPier の受入（`scripts/accept_aggrese_project.py` の `HELPER`、`tests/fixtures/acceptance/aggrese/record.json` の helpers の SHA）が WebPier の `scripts/` のファイルを固定しているので、WebPier 側は動かさない。複製との違いは1行目のコメントの決定番号だけ。
- **`--foundation-steps` と MCP**（2026-10-19、推奨どおり）：Batch の pointer は Phase 4 の前に `9c70f54` 以降へ進める。MCP の `aggrese_calculate` には今は足さない（ステップ表を使うのは WebPier の決定60だけで、WebPier は runner を直接呼ぶ）。WebPier 以外の案件で要るようになったら `generateFoundationSteps` を足す。
- **WebPier の開発のクライアント**：Claude Code だけ（Codex は使わない。2026-10-19、利用者）。WebPier に `.agents/skills`・`AGENTS.md` は作らず、WebPier の開発用スキル（`webpier-*`）は `.claude/skills` にだけ置く。Codex が主に使われるのは設計案件で、そこではグローバルの `structural-*` と MCP を使う。
- **Codex の配置先**：`~/.agents/skills`（Phase 0 の結果。`~/.codex/skills` も読まれるが、両方に置くと重複する）。
- **WebPier の headless の契約の細部**（Phase 4、2026-10-19。詳細は WebPier の決定61 と `phase4-webpier-mcp.md`）：artifacts の kind は WebPier の役割の `.` を `-` にしたもの（MCP の artifact の ID になる）。JRSNAP の結果フォルダーは中のファイルを1つずつ同じ kind で並べる。engineeringStatus は段階ごと（0612・0622 は ok/not_ok、ほかは not_evaluated）と全体（not_ok が1つでもあれば not_ok、判定した段階がすべて ok なら ok、判定した段階がなければ not_evaluated）。生成物の受け渡しは `read_artifact` で1つずつ（zip は遅いと分かってから）。`STRUCTURAL_MCP_MAX_*` は変えない（全段階の出力で最大のファイルは JRSNAP の `.DB2` 約40MB、artifact 単体の上限 128MB に収まる）。`webpier_generate` のタイムアウトは `nonlinearAnalysis` によらず `STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS`（既定30分）。

## 11. 対象外

- 汎用の開発スキル（plan、tdd、handoff、team-execute、_shared など）の一元化。
- Claude Code のプラグイン（MCP サーバーとスキルを一緒に配る形）。主なクライアントが Codex なので今回は採らない。
- WebPier の寸法・配筋の最適化（WebPier 自体の対象外）。
