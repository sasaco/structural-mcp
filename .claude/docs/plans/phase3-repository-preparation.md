# Phase 3：リポジトリの準備（GridLayoutPdf の参照、JRSNAPHeadless と WebPier の submodule 化）

- 状態: 作業中
- 更新日: 2026-10-19
- 親の計画: global-engine-skills-plan.md の Phase 3（§5.3）
- 引継ぎ元: HANDOFF.md

## 作業項目

- ✅ 現状を確かめる（各 repo の status・remote・未 push、WebPier の別のセッションの有無）
- ✅ GridLayoutPdf：変える前の WebPier の品質ゲートと dependency_hashes を記録する（3714 passed、カバレッジ全層で目標以上）
- [ ] GridLayoutPdf：pyproject.toml を git の参照に、uv.lock を作り直す、品質ゲート、受入への影響の確認、CLAUDE.md の手順、WebPier で commit
- ✅ JRSNAPHeadless：追跡ファイルの確認（JRSNAP 本体を含まない）→（確認）GitHub の private repo の作成と push →（確認）structural-mcp に submodule の登録
- [ ] WebPier：（確認）push →（確認）structural-mcp に submodule の登録
- [ ] structural-mcp の CLAUDE.md・README の更新、npm test、commit
- [ ] 別の場所に clone して submodule update と WebPier の uv sync --locked を確かめる
- [ ] 親の計画書の Phase 3 に ✅ と結果

## 始めたときの状態（2026-10-19）

| repo | ブランチ | HEAD | リモートとの差 | 作業ツリー |
|---|---|---|---|---|
| structural-mcp | `sassa/skills` | `d5c9b55` | — | 自分のものではない未コミット：`Capacita` の pointer（`-dirty`）、`.claude/skills/`、`HANDOFF.md`。commit に含めない |
| WebPier | `main` | `63e4edf` | `origin/main` より 4 先 | clean |
| GridLayoutPdf | `main` | `a8c52284a248ecf1f0a12013fa0ca597c9e0ab5f` | 同じ | clean（ignored だけ） |
| JRSNAPHeadless | `main` | `9e3c8fe` | リモートなし | clean |

- GitHub に `sasaco/JRSNAPHeadless` はまだない（`gh repo view` が「Could not resolve」）。

## JRSNAPHeadless の追跡ファイル（2026-10-19、`9e3c8fe`）

- `git ls-files` は30件：`.gitattributes`・`.gitignore`・`Directory.Build.props`・`JRSNAPHeadless.slnx`・`README.md`、`src/` の C# ソース・csproj・`App.config`（DataCheck・JRSNAP.Headless・LoadPicture・NdtWriter・NdtWriter52・NdtWriter53・ReportHost）、`tests/JRSNAP.Headless.Tests/` の C# 2件・csproj と fixture `線路直角方向.ndu`（WebPier が作った入力。JRSNAP の配布物ではない）。
- 拡張子 `.dll`・`.exe`・`.pdb`・`.ocx`・`.zip`・`.ndt` などは、いまの追跡にも、全履歴（`git log --all --name-only`）にもない。履歴にだけあるのは `src/JRSNAP.Headless/DataCheck.cs`（figures に置き換えたときに消えた自前のソース）だけ。
- JRSNAP 本体は実行時に `Assembly.LoadFrom`（インストール先の `JRSNAP_Input.exe` など）と反射（`mdlDataFile.mdl_Get_NDUDataFile` など）で呼んでいて、ソースに JRSNAP のコードの写しはない。csproj の参照は .NET Framework の標準のアセンブリと `Microsoft.NET.Test.Sdk` などの NuGet だけ（`HintPath` なし）。
- `.gitignore` は `bin/`・`obj/`・`TestResults/`・`*.user`・`.vs/`。
- → Phase 6 の再頒布の確認にも使える：**repo には JRSNAP（鉄道総研）の配布物を含まない**。

## 確認を取った操作（いつ・何を・利用者の返事）

| いつ | 何を | 返事 | 結果 |
|---|---|---|---|
| 2026-10-19 | GitHub に `sasaco/JRSNAPHeadless` を private で作り `main` を push | 「sasaco/JRSNAPHeadless で作る」 | `gh repo create sasaco/JRSNAPHeadless --private --source JRSNAPHeadless --remote origin --push`。visibility `PRIVATE`、`main` が `origin/main` を追跡（`9e3c8fe`） |
| 2026-10-19 | structural-mcp に JRSNAPHeadless を submodule として登録（commit はローカルだけ、push しない） | 「登録する」 | `git submodule add https://github.com/sasaco/JRSNAPHeadless.git JRSNAPHeadless` が「Adding existing repo」で既存の repo をそのまま使った。`JRSNAPHeadless/.git` はディレクトリのまま（absorbgitdirs はしていない）。gitlink `9e3c8fe` |
| 2026-10-19 | 変更後の品質ゲートが通ったら、WebPier で GridLayoutPdf の git 参照を commit し、`main` を origin に push | 「ゲートが通ったら push」 | |
| 2026-10-19 | push の後、structural-mcp に WebPier を submodule として登録（absorbgitdirs はしない、commit はローカルだけ） | 「登録する」 | |

## 設計の考え方と背景

- **GridLayoutPdf の参照**：`{ git = "https://github.com/sasaco/grid_layout_pdf", rev = "a8c52284a248ecf1f0a12013fa0ca597c9e0ab5f" }`（完全な SHA。いまの作業ツリー・`origin/main` と同じ commit なので、組版の中身は変わらない）。`uv lock` の差分は `gridlayoutpdf` の `source` が git に、`[package.metadata]`（path の参照のときだけ書かれる GridLayoutPdf 自身の依存の写し）が消えただけで、ほかのパッケージの版は動かない。
- **手元で GridLayoutPdf を直しながら使う手順**：候補は (a) `pyproject.toml` を一時的に path の参照に戻して `uv lock`、(b) `uv pip install` で venv だけ差し替える、の2つ。(a) は `pyproject.toml`・`uv.lock` を書き換えるので誤って commit しやすい。(b) を採り、WebPier の CLAUDE.md に書いた：
  - 試す：`uv pip install --python ".venv" --no-deps --reinstall "<GridLayoutPdf>"`、実行は `uv run --project "." --no-sync ...`。
  - `--locked` の実行（品質ゲート・CLAUDE.md のコマンド）は venv を lock の git の版に戻す。**確かめた**（`uv pip install` の後 `direct_url.json` が `file:///…/GridLayoutPdf`、`--no-sync` の実行ではそのまま、`uv run --locked` で「Uninstalled 1 / Installed 1」と git の版に戻った）。品質ゲートは常に lock の版で走るので、手元の版のまま受入やゲートを通したと誤認しない。
  - 取り込む：GridLayoutPdf で commit・push → `rev` をその SHA に → `uv lock --project "."` → `uv sync --project "." --locked` → 品質ゲート → `pyproject.toml` と `uv.lock` を一緒に commit。
  - 以前の `uv sync --locked --reinstall-package gridlayoutpdf` は、git の参照の下では lock の版を入れ直すだけで手元の変更を取り込まないので、CLAUDE.md・README から消した。

## 新しく分かったこと

- WebPier の venv の GridLayoutPdf は `path` の参照から**非 editable**でインストールされている（`direct_url.json` の `"editable": false`）。site-packages の `gridlayoutpdf/` の24ファイル（`.pyc` を除く）は、GridLayoutPdf の作業ツリーの `src/gridlayoutpdf/`（`a8c5228`）とバイトが一致した（`sha256sum` の比較。記録は scratchpad の `phase3/glp-installed-before.txt`）。
- GridLayoutPdf の作業ツリーは、Python ファイルの改行が LF と CRLF の混在（index はすべて LF、`core.autocrlf=true` が SourceTree の system gitconfig にある）。`path` の参照ではこのバイトがそのまま入るので、git の参照に変えると改行が変わり、`dependency_hashes` の値（`implementation_sha256`）が変わりうる。
- **git の参照に変えた後**（`uv sync --locked` で「from git+https://github.com/sasaco/grid_layout_pdf@a8c5228…」）、インストールされた `gridlayoutpdf/` のファイルは**すべて CRLF** になった（uv の git の取り出しが `core.autocrlf=true` に従った）。24ファイルのハッシュは変更前とすべて違うが、改行を除くと `a8c5228` の `src/gridlayoutpdf/` と全件一致。→ `implementation_sha256` は変わり、しかも PC の git の設定（`core.autocrlf`）で変わる。
- **受入記録と `implementation_sha256`**：受入記録（`tests/fixtures/acceptance/*/record.json`）は記録したときの `implementation_sha256` を持つが、テストはそれをいまの値と照合しない（記録は 2026-10-19 の `7e7e789` の時点、そのあと `63e4edf` で `webpier` のソースが変わっても 3714 件が通っている）。受入のテストが照合するのは生成物のバイトと、実アプリが読んだ記録。したがって GridLayoutPdf の改行の違いで受入の取り直しが要るのは、生成物（PDF など）のバイトが変わったときだけ。

## Tips

- WebPier の品質ゲートは、Bash の `run_in_background` で `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .claude/check.ps1` として回し、完了の通知を待つ。途中経過は `tmp/quality-gates/pytest-<時刻>.log`。
- **失敗したこと**：ゲートの実行中に届いた「完了」の通知を信じてログを見たら途中（42%）だったので、プロセスが残っているかを Git Bash の `tasklist //FI "PID eq …"` で待とうとした。この絞り込みが効かずにすぐ抜け、止まっていると誤認して正常に進んでいた pytest を `taskkill` してしまった（そのあと本当の終了の通知が exit 2 で届いた）。ゲートは止めずに、本当の終了の通知を待つ。

## ほかの作業者へ
