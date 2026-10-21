# 手で試す・Capacita を直す

## 手で試す

1. WDJ の複製を作り（旧 WebDan のものなら `shape` を `"1"`、必要なら `calc.print_section_force_checked: true`）、空のフォルダーに runner を呼ぶ（SKILL.md の `run-rc`）。
2. 頁を画像にする（開発機に pdftoppm はない）：
   `uv run --no-project --with pymupdf python -X utf8 -c "import pymupdf; d=pymupdf.open(r'<pdf>'); [p.get_pixmap(dpi=90).save(f'<dir>/p{i+1}.png') for i,p in enumerate(d)]"`
   見本の PDF の頁も同じ方法で読む（解説の頁は文字、結果の頁は表、図は JPEG の埋め込みのことが多い）。
3. 見本の WDJ（旧 WebDan で作ったもの）を今の Capacita で計算し、見本の計算書と照査値・耐力を比べると、入力の違いと版の違いを切り分けられる。

## Capacita を直すとき（開発機のみ）

- Capacita の規則（submodule の `.claude/rules/`）に従う。submodule の中で commit し、structural-mcp の pointer を更新する。
- 直したら Release でビルドし直す（structural-mcp のルートで `dotnet build .\Capacita\WebDanforCS\Headless\WebDanforCS.Headless.csproj -c Release`）。
- 品質ゲートは submodule の `.claude/check.ps1`（宣言は `.claude/repository.toml`。2026-10-21 の edee272 で `.agents` から直した。それより前の commit では no_gates になる）。
- テストは `dotnet test` で `WebDanforCS/tests/UiTests`（`ReportSectionsTests`・`HeadlessPickupTests`）。`PreviewTests` の `.agents/logs` 未作成、クリップボード、Steel 印刷は以前から落ちることがある（変更と無関係のことが多い）。`WebDanforCS.Tests` は NU1201 で restore できず、`RcDan/tests` は確認用の WinForms アプリ（2026-10-18）。
- RcDan を直接呼ぶテスト（`ReportSectionsTests` など）が先に走ると RcDan が自分の PDF フォントリゾルバーを入れ、後の計算が「Must not change font resolver after is was once used.」で落ちる。UiTests はアセンブリの初期化（`TestAssemblyInitializer.cs`）でアプリと同じ共有のリゾルバー（`SharedPdfFonts`）を入れて避けている（f385359）。新しいテストのアセンブリを作るときも同じにする。
- 節の ID を変える・足すと、計算書を節ごとに切り分けて使う利用者（WebPier など）とその代役の runner も合わせる必要がある。`run-rc` のやり取りを変えたときも同じ。
