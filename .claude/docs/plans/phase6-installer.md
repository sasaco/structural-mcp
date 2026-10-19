# Phase 6：installer（WebPier・JRSNAPHeadless・スキル）

- 状態: 実装・検証済み（MSI の実インストール・修復・削除の検証 `msi-lifecycle.ps1` だけが残り。この PC の Windows Installer が全 MSI で 1603 を返すため）
- 更新日: 2026-10-20
- 親の計画: global-engine-skills-plan.md の Phase 6（§6）、§4.3、§9 の5
- 引継ぎ元: HANDOFF.md

## 作業項目

- ✅ 現状を確かめる（installer の build・runtime・verify・tests を読んだ）
- ✅ 調べる：利用先に git がなくても WebPier の `uv sync --locked` が通るか → **通らない**（下の「新しく分かったこと」）
- ✅ 調べる：JRSNAPHeadless の Release の出力の一覧（JRSNAP の DLL が混ざらないこと）、`jrsnap-headless.json` の書式
- ✅ 確認：GridLayoutPdf の扱い → WebPier 側を変えて GitHub Release の wheel を参照する。JRSNAPHeadless は MSI に**入れない**（下の表）
- ✅ GridLayoutPdf の Release `v0.1.0`（wheel）を作る
- ✅ WebPier：`pyproject.toml` の参照を Release の wheel に、`uv.lock`、CLAUDE.md・README の手順。品質ゲート（3762 件通過、18分31秒、pipeline 100%）→ commit `78654a2` → push 済み
- ✅ 設計：payload の配置、環境変数、スキルの配置と受領記録（下の「設計の考え方と背景」）
- ✅ build：payload.mjs（WebPier・skills の複写、provenance、notices、limitations）
- ✅ runtime：launcher.mjs（WebPier の Python、登録の環境変数、health、unregister）、skills.mjs（新規）、structural-mcp.ps1（`-NoSkills`・`-SkillsHome`）
- ✅ tests：runtime.test.mjs（27件。WebPier の bootstrap・登録、スキル8件）、installer の全テスト 34件、npm test 66件
- ✅ verify（コード）：payload-smoke.mjs（WebPier 0500〜0622、スキル）、msi-lifecycle.ps1・create-registration-fixture.mjs・manifest-integrity.mjs（スキルの配置と解除）
- ✅ verify（実物）：`build-installer.ps1 -Preview -ArtifactSuffix phase6`、`payload-smoke.mjs --initialize --relocate`（下の「実物での確認」）
- [ ] verify（実物）：`msi-lifecycle.ps1`（利用者の確認済み）→ **この PC の Windows Installer が全 MSI で 1603 を返すため未完**（下の「実物での確認」）。サービスの再起動か PC の再起動の後に、同じ MSI でやり直す
- ✅ README（installer/README.md、README.md・CLAUDE.md・skills/README.md）
- ✅ commit（確認済み、push しない）、submodule の pointer（WebPier 2652cad → 78654a2）、親の計画書の Phase 6 に「結果」（✅ は lifecycle の後）

## 確認を取った操作（いつ・何を・利用者の返事・結果）

| いつ | 何を | 返事 | 結果 |
|---|---|---|---|
| 2026-10-19 | git のない PC で GridLayoutPdf（git の参照）が取れない件の対応（wheel を同梱／MinGit を同梱／WebPier 側を変える） | 「WebPier 側を変える」 | 下の行 |
| 2026-10-19 | JRSNAPHeadless（private repo）のバイナリを MSI に入れて配ってよいか | 「入れない」 | payload に入れない。JRSNAP の検出・`jrsnap-headless.json` の書出し・`--jrsnap` の検証は作らない。WebPier の 0710 以降は MSI では使えない |
| 2026-10-19 | WebPier の参照の形（commit の tar.gz／Release の wheel） | 「Release の wheel」 | 下の行 |
| 2026-10-19 | WebPier の変更を品質ゲートの通過後に main へ commit・push | 「ゲート通過後に push」 | ゲート pass の後、`git commit --only` で `78654a2`（CLAUDE.md・README.md・pyproject.toml・uv.lock）、`2652cad..78654a2 main -> main` |
| 2026-10-20 | `msi-lifecycle.ps1` を phase6 の MSI（`90a53c3d…`）で実行 | 「実行してよい」 | 2回とも 1603（Windows Installer の状態。下の「実物での確認」）。製品は残っていない |
| 2026-10-20 | structural-mcp の commit（自分のファイルと WebPier の pointer、push しない） | 「commit してよい」 | 下の「ほかの作業者へ」 |
| 2026-10-19 | `sasaco/grid_layout_pdf` に Release `v0.1.0`（タグを `a8c5228` に、資産 `gridlayoutpdf-0.1.0-py3-none-any.whl`） | 「作ってよい」 | `gh release create` で作成。ダウンロードした wheel の SHA-256 が手元と一致（`bacfa765…`）。タグ `v0.1.0` → `a8c52284…` |

## 設計の考え方と背景

- **GridLayoutPdf は Release の wheel（利用者の判断）**。uv は git の依存を git の実行ファイルで取るので、git のない利用先では `uv sync --locked` が止まる。代案のうち、installer 側で wheel を同梱する案は WebPier を変えずに済むが、利用者は WebPier の参照そのものを git に依存しない形にすることを選んだ。commit の tar.gz（GitHub のアーカイブ）も試して通ったが、アーカイブのバイトは公式には不変が保証されないので、バイトが固定される Release の資産にした。wheel は `core.autocrlf=false` で取り出し `SOURCE_DATE_EPOCH=315532800` で作る（同じ commit から同じバイト）。これで WebPier の Python 環境は FrameWeb と同じ `uv sync --locked --no-dev --managed-python --python 3.12.12` で作れ、launcher の bootstrap は2つの project を同じ手順で回すだけになる。副次的に、開発機でも GridLayoutPdf の改行が git の設定によらなくなる（`implementation_sha256` が PC で変わらない）。
- **JRSNAPHeadless は入れない（利用者の判断）**。private repo のバイナリを配布先に渡さない。登録では `STRUCTURAL_MCP_JRSNAP_RUNNER` を渡さない。server の既定のパスはインストール先の `server\JRSNAPHeadless\…` で存在しないので、jrsnap は検出されず、`webpier_get_contract` は 0710 以降を `missingRunners: ["jrsnap"]` と返す。health はその一覧を表示するだけで失敗にしない。
- **payload の配置**：`engines\WebPier\`（`run_headless.py`・`webpier\`・`pyproject.toml`・`uv.lock`・`README.md`・`.python-version`）。`.venv` は `run_headless.py` の横に setup が作る（structural-mcp は `.py` の runner を横の `.venv\Scripts\python.exe` で起動し、`.venv` がなければ runner がないとみなすため）。`skills\structural-*\`。provenance は `WebPier` の repo の記録を足し、root の範囲に `skills` を足した。
- **登録**：`STRUCTURAL_MCP_WEBPIER_RUNNER` を足し、`tool_timeout_sec` を 300 から 1800 に（WebPier の生成の上限 `STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS` の既定30分、README の推奨と同じ）。既存の登録とは値が変わるので、再セットアップで書き換わる。
- **health**：FrameWeb と WebPier の Python のインポート、WebPier の `run_headless.py contract`（protocol v1、ok）、MCP の `get_capabilities`（webpier が enabled）と `webpier_get_contract`。スキルの SHA-256 の照合は health のショートカット（`health` アクション）だけで行い、setup の中の health では行わない（消えたコピーを setup が戻せなくなるため）。
- **スキル**（`installer/runtime/skills.mjs`）：`scripts/install-skills.mjs` と同じ規則をコピー専用で実装した（payload には repo の scripts を入れず、runtime の1ファイルにした）。
  - コピー先は `<CLAUDE_CONFIG_DIR または ~/.claude>\skills` と `~/.agents/skills`。`--skills-home` は両方をそのフォルダーの下にする（検証用。テスト・fixture・smoke はこれで実際のフォルダーに触れない）。
  - 受領記録はインストール先の `skills-install-state.json`（Codex の登録の記録 `codex-registration-state.json` と同じ置き方）。項目ごとにコピー先・名前・**ファイルごとの SHA-256** を持つ。
  - 止まる条件（どれか1つでもあれば何も変えない）：同じ名前のリンク・ファイル、記録にないフォルダー、記録にあるが中身が記録と違う（編集された）フォルダー。setup は Codex の登録と長いダウンロードの**前に**この検査をする（`dryRun`）。
  - 解除は、記録にあって中身が記録と同じものだけを消す。編集されたもの・リンクに変わったものは残し、記録から外す。Codex の登録の解除が失敗してもスキルの解除は行う（アンインストールは続くため）。
  - コピーの途中で止まった場合に備え、コピーの前に `pending` で記録する。`pending` の項目は中身の照合なしに次の setup が置き換え、解除が消す。
  - 版を上げたとき（MSI のメジャーアップグレードは旧版のファイルを消すが、記録は残る）、`--replace-existing` を付けると、隣のインストール先（`Programs\structural-mcp\<別の版>`）の記録にあって中身が変わっていないコピーを引き継ぎ、旧版の記録からその項目を外す。Codex の登録の `--replace-existing` と同じ考え方。
- **アンインストール**：既存の custom action（`launcher.mjs unregister-codex --quiet`）がスキルの解除も行うので、Product.wxs は変えていない。

## 実物での確認

- **build**（2026-10-20 00:02〜00:08）：`build-installer.ps1 -Preview -ArtifactSuffix phase6` → `.structural-mcp/installer-work/20261020-000253-5dcaddfe/`。MSI `structural-mcp-0.2.0-preview-phase6-win-x64.msi`（222,921,171 バイト、SHA-256 `90a53c3de2776920d611059712c49c3f18db53f02d9efa0d8ddc94e7c27a833c`）。payload 5247 ファイル：`engines/WebPier/` 168（`run_headless.py`・`pyproject.toml`・`uv.lock`・`README.md`・`.python-version` と `webpier/`）、`skills/` 7本 36 ファイル、JRSNAPHeadless の exe はなし。`release-manifest.json` の sources：WebPier `78654a2`（dirty なし）、root `56727cd`（この Phase の未コミットの変更で dirty）、Capacita `a29c9b4`（別のセッションで dirty、packaged の範囲は clean）、FEMPython `b2584ce`、Batch `c15b3c4`、SoilStructure `ef41177`。THIRD-PARTY-NOTICES に WebPier・GridLayoutPdf・JRSNAP を同梱しない旨、limitations に2行。
- **payload-smoke**（`--initialize --relocate`、作業フォルダー `%TEMP%\structural-mcp-verify-QjKfrS`、ok）：PATH は `System32` だけ（git なし）で、FrameWeb と WebPier の `.venv` を `uv sync --locked` で作れた。WebPier の Python・GridLayoutPdf・PyMuPDF・ReportLab は移動先（`移動先 with spaces\structural-mcp\engines\WebPier\.venv`）、CPython は隔離した data の下。`webpier_get_contract` の `unavailableStages` は 0710・0711・0720・0721・0800・0810・0820・0900・0910。`webpier_validate`（all＋frameAnalysis）の後、`WebPier\pre\input.json`（SHA-256 `3135607c…`）で 0500（2ファイル）・0600（2）・0610（4）・0611（10）・0612（8、engineeringStatus ok）・0620（4）・0621（10）・0622（8、ok）を生成し、全成果物のバイト数・SHA-256・PDF の先頭を確かめた。260 文字の問題は起きなかった。スキルは隔離したホームの2か所へ 7本×2＝14 をコピーして SHA-256 が一致し、unregister で消えた。Capacita・SoilStructure・FEMPython の既存の検査もすべて通った。
- **msi-lifecycle**（2026-10-20 00:14・00:15、利用者の確認済み）：2回とも `install exited 1603` で止まった（`root-verification/msi-lifecycle-20261020-001418-0698a851`・`…-001519-c82e0b50`。2回目は Claude Code の sandbox の外で実行）。製品は登録されず、実際の `~/.codex/config.toml` の SHA-256 は前後で同じ（`3f9d0a58…`）、既定のインストール先も作られていない。ログはサーバーの `Grabbed execution mutex.` の直後に `MainEngineThread is returning 1603` で、パッケージを開く前（`RunEngine` の前）に失敗している。原因の切り分け：製品を登録しない管理用の展開（`msiexec /a`）も、10/16 に lifecycle が通った旧 MSI（`repairfix1`）の `/a` も同じく即 1603。したがって MSI の中身ではなく、この PC の Windows Installer サービスの状態による（`PendingFileRenameOperations` があり、再起動待ちでもある）。msiexec のプロセスはサービスの1つだけだった。サービスの再起動・PC の再起動は利用者の判断なので行っていない。

## 新しく分かったこと

- **git がない PC では WebPier の `uv sync --locked` が失敗する**（2026-10-19、uv 0.10.0。PATH を `C:\Windows\System32` だけにして、空の cache で試した）：`Git operation failed ╰─▶ Git executable not found. Ensure that Git is installed and available.`（`gridlayoutpdf` の git の参照）。
- 同じ隔離の条件で通ったもの：(1) installer 側で wheel を作り `uv export --locked --no-dev --no-emit-project --no-emit-package gridlayoutpdf` の要求ファイルに wheel の hash を足して `uv venv` ＋ `uv pip sync --require-hashes`、(2) `{ url = "https://github.com/…/archive/<sha>.tar.gz" }`（uv.lock に sdist の hash。利用先で hatchling を取って build）、(3) `{ url = "<Release の wheel>" }`（採用。uv.lock に wheel の hash）。
- `SOURCE_DATE_EPOCH` なしの `uv build --wheel` は、ビルドの時刻で wheel のバイトが変わる。付けると2回のビルドで一致した。
- JRSNAPHeadless の `bin/Release` は `JRSNAP.Headless.exe`・`JRSNAP.NdtWriter52.exe`・`JRSNAP.NdtWriter53.exe`・`JRSNAP.DataCheck.exe`・`JRSNAP.LoadPicture.exe` と各 `.exe.config`・`.pdb`、手元の `jrsnap-headless.json`（gitignore）だけ。csproj は JRSNAP の DLL を参照しない（実行時にインストール先から読む）。出力先は `src/Directory.Build.props` の `OutDir`（`bin\<構成>\`）。手元の `bin/Release` の runner は `2374a5b` の build で、HEAD（`9e3c8fe`）より古い。
- 引数なしの `JRSNAP.Headless.exe` は protocol v1 の envelope（`INVALID_ARGUMENT`、category `input`、exit 1）を返す。
- GridLayoutPdf の repo（a8c52284）と WebPier の repo には LICENSE ファイルがない。
- WebPier の headless は `.env` を読まない（決定61）。`webpier\` の外で要るのは `run_headless.py` だけ（`PROJECT_DIR` は CLI・GUI の既定のパス）。
- WebPier の段階を直接選ぶ（`stage: "0612"` など）と、その段階だけを作る（依存段階は内部で計算して公開しない）。runner が要らないのは 0500・0600、FEMPython だけが 0610・0612・0620・0622、FEMPython と Capacita が 0611・0621。

## Tips

- git なしの隔離：`env -i SystemRoot='C:\Windows' PATH='/c/Windows/System32:/c/Windows' LOCALAPPDATA=… USERPROFILE=… TEMP=… TMP=… UV_PYTHON_INSTALL_DIR=… UV_CACHE_DIR=… uv.exe …`（Git Bash）。試作は `C:\tmp\wpgit`・`C:\tmp\wpurl`・`C:\tmp\wpurl2`。
- Git Bash の heredoc で Node のコードを流すと、`\` と日本語を含む置き換えが壊れる（`\W` が Unicode escape と解釈されるなど）。Edit ツールで直す。

## ほかの作業者へ

- 自分のものではない未コミット（触らない）：`Capacita` の pointer、`FEMPython` の pointer、`skills/structural-capacita/SKILL.md`、`.claude/skills/`、`HANDOFF.md`。
- **残りの作業**：Windows Installer が直ったら（`msiexec /a <MSI> /qn TARGETDIR=<空のフォルダー>` が 0 で終わることで確かめられる）、`powershell -NoProfile -ExecutionPolicy Bypass -File installer/verify/msi-lifecycle.ps1 -MsiPath '<repo>\.structural-mcp\installer-work\20261020-000253-5dcaddfe\msi-phase6\structural-mcp-0.2.0-preview-phase6-win-x64.msi' -ExpectedSha256 90a53c3de2776920d611059712c49c3f18db53f02d9efa0d8ddc94e7c27a833c` を実行する（この MSI は commit 前の作業ツリーから作った。commit 後に作り直してもよい）。結果をここと親の計画書に書き、親の計画書の Phase 6 に ✅ を付ける。
- 作業中に root に別のセッションの commit `56727cd`（Phase 8 の残りの記録）が入り、Batch の pointer は `c15b3c4` になっていた。
- 手元の `C:\Users\sasai\Documents\GridLayoutPdf` は `CONTEXT.md` が未コミット。Release の wheel は別に clone した `a8c5228` から作り、手元は触っていない。
