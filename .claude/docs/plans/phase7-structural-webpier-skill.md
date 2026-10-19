# Phase 7：`structural-webpier` スキル

- 状態: 作業中（スキルは完成。最終確認（§9 の3）が残り）
- 更新日: 2026-10-19
- 親の計画: global-engine-skills-plan.md の Phase 7（§3 の構成、§6 Phase 7）
- 前の Phase: `phase4-webpier-mcp.md`（MCP のツール名と契約が決まった）

## 作業項目

- ✅ SKILL.md：何を作るアプリか、できないこと、MCP での流れ、段階とスイッチの選び方、成果物を置く、入力エディタ、runner を直接呼ぶ方法、知見の追記先（約100行）
- ✅ references/：`input-schema2.md`・`stages.md`・`checks.md`・`outputs.md`・`troubleshooting.md`
- ✅ 成果物を案件の `output/`・`post/` に置く補助スクリプト `scripts/place-webpier-outputs.mjs` と、そのための server の変更（`get_capabilities` の `pathPolicy.jobRoot`）、テスト `tests/webpier-place.test.ts`
- ✅ WebPier の開発用スキルの利用者向けの部分を `checks.md` に移す（WebPier 側から消すのは Phase 8）
- ✅ `npm test`（66件。skills の静的検査を含む）、`npm run skills:install`、Claude Code と Codex の新しいセッションで `structural-webpier` が選ばれる
- [ ] 最終確認（§9 の3）：P7橋脚 で「線路方向の基礎の照査まで作って」（進め方は利用者に相談）
- [ ] 親の計画書の Phase 7 に ✅ と結果

## 確認を取った操作（いつ・何を・利用者の返事・結果）

| いつ | 何を | 返事 | 結果 |
|---|---|---|---|
| 2026-10-19 | Phase 7 をこのセッションで行う | 「次のPhase 7 もこのセッションで実施して」 | 着手 |

## 設計の考え方と背景

- **成果物の受け渡しはスクリプトで job から複写する**（親の計画書 §5.2 の「まず `read_artifact` で1つずつ」から変えた）。`read_artifact` は Base64 をエージェントの文脈に通すので、0612 だけでも合計約150KB（Base64 で約200KB）、0611・0910 の計算書は1つ 1〜2MB、JRSNAP の結果は数十MB になり、使えない。MCP サーバーは同じ PC のローカルの STDIO サーバーなので、クライアントが job のフォルダーを読めばよい。
  - server は `get_capabilities` の `pathPolicy.jobRoot` に job root を出すだけ（読取りの案内。出力先は受け取らないという不変条件は変わらない）。job は `<jobRoot>/<日付>/<jobId>`。
  - スクリプトは `manifest.json` の全成果物のバイト数と SHA-256 を確かめてから書く。`webpier_generate` の成功した job だけ。既定は上書きしない（`--overwrite`）。JRSNAP の結果フォルダーは丸ごと置き換え、ほかの前のファイルは残す（WebPier の CLI と同じ）。`--dry-run` あり。
  - 言語は **Node**（親の計画書は Python と書いていた）。structural-mcp の server が Node 24 を要るので、MCP を使える PC には必ずある。Python は Git Bash の PATH にないことがあり、MSI の利用者の Python は WebPier の venv の中にしかない。
  - 別の PC のサーバーなら `read_artifact` を使う（SKILL.md に書いた）。
- **項目の一覧は書かない**（親の計画書 §6 Phase 7 の2）：`webpier_get_input_schema` を正とし、`input-schema2.md` には意味（寸法の図の定義、支承位置の測り方、水位の基準、空き支承枠、派生値、どの段階が使うか）と、資料から写すときの注意だけを書いた。寸法 B1〜B9・W1〜W9・H1〜H6 の定義は入力エディタの図（`webpier/gui/assets/substructure_large.png`）、h1〜h4 は計算での使われ方（`webpier/calc/reaction/transverse.py`）から確かめた。
- **段階の表は contract から写した**（`run_headless.py contract`）。README の文と違うところがあった：`--stage 0800` が一緒に作るのは 0612・0622・0711・0721（0611・0621 は入らない）、`all`＋`nonlinearAnalysis` は 0910 のために Capacita も要る。
- `description` はエンジン（アプリ）中心に、決定番号と案件名を入れずに書いた（skills/README.md）。

## 新しく分かったこと

- Claude Code（`claude -p`、MCP なし、Skill だけ許可）と Codex 0.163.0（`codex exec --ephemeral --sandbox read-only -m gpt-6-luna`）の新しいセッションに「線路方向の基礎の照査まで作って」と頼む前提で手順を尋ねると、どちらも `structural-webpier` を読み、`stage: "0612"`・FEMPython・補助スクリプトでの配置と答えた（2026-10-19）。Codex の出力のコンソールでの文字化けは表示だけ。
- P7橋脚 の資料（`NJC→ささこう`）は DocuWorks（`.xbd`・`.xdw`）が中心だが、`02_P7橋脚/図面/PDF/` に一般図・計画基準図、`02_P7橋脚/計算書等/` と `03_P7橋脚（鉄道照査）/計算書等/` に設計計算書の PDF（321・288ページ、文字を取り出せる）、`03_P7橋脚（鉄道照査）/SNAP（nduデータ）/` に過年度の JRSNAP の NDU がある。基礎は直接基礎（計算書に「直接基礎」64か所、杭の語なし）なので WebPier で扱える。

## ほかの作業者へ

- `structural-webpier` の利用者向けの内容は WebPier の README・CONTEXT.md と開発用スキル（foundation-check など）から写した。Phase 8 で WebPier の開発用スキルから使い方の部分を消すときは、このスキルに無いものが残っていないかを比べる。
