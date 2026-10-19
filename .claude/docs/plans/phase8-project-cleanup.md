# Phase 8：各プロジェクトの片付け

- 状態: 完了（2026-10-19）
- 更新日: 2026-10-19
- 親の計画: global-engine-skills-plan.md の Phase 8（§6）
- 引継ぎ元: HANDOFF.md

## 作業項目

- ✅ 現状を確かめる（各 repo の status・ブランチ・別のセッション、案件のスキルの一覧）
- ✅ 差分：各案件のスキルと structural-* を比べ、グローバル側に無い記述を洗い出す
- ✅ 移す：無い記述は桑園の案件の記録だけ。`slab-shear-summary/references/` へ移した（グローバルへ移すものはなかった）。structural-webpier の checks.md の開発用スキル名を直した。`npm test` 66件成功
- ✅ WebPier：開発用スキルは削らず（使い方だけの部分はなかった）、structural-webpier への参照を足し、3本を `webpier-*` に改名（`2652cad`、push 済み）・pointer
- ✅ 26_関内：10本を削除・CLAUDE.md/AGENTS.md・commit（`6861bbc`、push はしていない）
- ✅ 26_桑園高架橋：記録を `slab-shear-summary` へ移す → 4本を削除・AGENTS.md・commit（`512cad2`、push はしていない）
- ✅ 26_上越新幹線(固有周期)：4本を削除・commit（`1ad5d30`、push はしていない。CLAUDE.md/AGENTS.md は利用者の判断で作らない）
- ✅ Batch：3本を削除・commit（`c15b3c4`、sasa/dev、GitLab へ push 済み）・pointer
- ✅ 新しいセッションで各案件から同じ structural-* が読まれ、古いスキルが出ないことを確かめる（下の「読み込みの確認」）
- ✅ 親の計画書の Phase 8 に ✅ と結果

## 現状（2026-10-19 に確認）

| repo | ブランチ・HEAD | 作業ツリー | 消す候補の置き場 |
|---|---|---|---|
| WebPier（submodule） | main `b6c349c` | きれい | `.claude/skills/`（開発用：foundation-check・footing-check・cantilever-check・webpier-aggrese・webpier-capacita・webpier-jrsnap・pier-report-style、受入の補助 jrsnap-input-open-save/scripts） |
| 26_関内 | main `eea92b6` | **別の作業の未コミットが多い**（EVピット部の src・tests・input.json、CONTEXT.md、未追跡 `.mcp.json`） | `.claude/skills/`（`.agents/skills` はない）。追跡済み |
| 26_桑園高架橋 | main `b9b3344` | きれい | `.agents/skills/`（`.claude/` はない）。追跡済み。CLAUDE.md はなく AGENTS.md だけ |
| 26_上越新幹線(固有周期) | main `2386abe` | **`.agents/` → `.claude/` の移動が未コミット**（追跡済みの `.agents/**` が削除、`.claude/` が未追跡）。`geology-column-log-analyze/SKILL.md` が 2026-10-19 10:45 に更新、未追跡 `outputs/no453-analysis-20261019`、`sdc2ndu/scripts` が変更 | `.claude/skills/`（未追跡）。CLAUDE.md・AGENTS.md はない |
| Batch（submodule） | **detached** `9c70f54`（= `sasa/dev` = `origin/sasa/dev`） | きれい | `.claude/skills/`（3本、追跡済み） |

## 差分と移した記述（プロジェクト・スキルごと）

改行を除いた md5 で、各コピーを Phase 5 で基準にした WebPier の版（`jrsnap-*`・`capacita-column-check` は `3dcf9ae^`、`aggrese-project` は `5afe305^`、`foundation-check`・`pier-report-style` はいまの HEAD）と比べた（scratchpad の `cmp.sh`）。

### 26_関内（`.claude/skills/`）

| スキル | 比較 | 判断 |
|---|---|---|
| jrsnap-data-check・-input-open-save・-load-diagram・-ndu-edit（references 3つ）・-soil-analysis、全 scripts | WebPier の `3dcf9ae^` と同一 | Phase 5 で structural-jrsnap-* へ移し済み |
| jrsnap-input-launch | 1行だけ違う（Aggre-SE への参照が `[aggrese-project](…)`） | 同上 |
| aggrese-project | WebPier の `5afe305^` と同一 | Phase 2 で structural-aggrese・webpier-aggrese へ移し済み |
| capacita-column-check | WebPier の `3dcf9ae^` より古い（0910 の節、WD-1913 までの範囲、Dmax の訂正がない）。関内にしかない行はない | Phase 5 で移し済み |
| foundation-check | WebPier の HEAD より古い（`pick` の同値の規則、`--stage` の規則、受入の取り直しの行がない）。関内にしかない行はない | WebPier に正がある |
| pier-report-style（scripts/compare_pages.py も） | WebPier の HEAD と同一 | WebPier に正がある |

関内のほかのファイル（`check.ps1` の「live script references」の検査、`rules/`、`evpit-*`、`context-loader`）は、消すスキルのスクリプトを参照していない（`auto-pair-relay` が `jrsnap-operator` の名前に触れるだけ）。

### 26_桑園高架橋（`.agents/skills/`）

| スキル | 比較 | 判断 |
|---|---|---|
| jrsnap-input-launch・-input-open-save・-soil-analysis | 旧系統（Batch・上越と同一）。違いは description とパスの書き方（`C:\Users\sasai\Documents\Batch` 起点）だけ。旧系統にだけある文（「開く・上書き保存は .ndu の操作」「既存の SOIL-JR を止める」「E と S の既定名」）は structural-jrsnap-input の open-save.md・structural-jrsnap-soil の SKILL.md にある | 消してよい |
| jrsnap-ndu-edit/SKILL.md | WebPier 版から見本照合の1行がないだけ。ただし案件の規則（L3 の形状コード15の要約、総括表への転記、Mdmax の符号で引張主筋を選ぶ規則）を含む | 案件の規則は `slab-shear-summary` の SKILL.md・`input-sources.md`・`tension-side.md` にすでにある |
| jrsnap-ndu-edit/references/sect-frange-jiku.md・section-material-geometry-rebar.md | WebPier の `3dcf9ae^` と同一。一般の部分は structural-jrsnap-ndu の section-fields.md にある。**案件の記録**（2026-10-12 の L3・L4・C1-1・C2-2・C3-2 の SectFrangeJiku の編集、2026-10-14 の L3 の読み取りと総括表 E47・E48・E51・E61 への転記、L3 の段の選び方、下端の例、`L3諸元.xlsx`、a＝内法長/2）は**グローバルにない** | **消す前に `slab-shear-summary/references/` へ移す** |

`slab-shear-summary` の `calculation.md:84` と `tension-side.md:28` が `../../jrsnap-ndu-edit/references/…` を参照している。`AGENTS.md` は NDU の編集で `jrsnap-ndu-edit` を読むよう指示している。

### 26_上越新幹線(固有周期)（`.claude/skills/`、未追跡）

旧系統。`jrsnap-input-launch`・`-open-save`・`-soil-analysis` は桑園と同一。`jrsnap-ndu-edit` は桑園よりさらに古い（references は sect-frange-jiku.md だけで、第1・第4フィールドを「未確認」としていた古い文がある）。上越にしかない記述はない。git には同じ内容が `.agents/skills/jrsnap-*` として追跡されている（作業ツリーでは削除済み・未コミット）。

### Batch（`.claude/skills/`）

旧系統で桑園と同一（3本）。Batch にしかない記述はない。

### WebPier（`.claude/skills/`）

`foundation-check`・`footing-check`・`cantilever-check`・`webpier-capacita`・`webpier-aggrese` を、structural-webpier の checks.md・outputs.md・input-schema2.md と並べて読んだ。どれも「置き場所」「式と見本の扱い」「受入」「直すとき」などの実装・決定・受入の知識で、**使い方だけの部分はなかった**（`## 生成` の CLI も開発者が scratchpad に出す手順）。式の要約（0612 の4列、qd の上限など）は checks.md と重なるが、開発に要るので残した。代わりに、各スキルの「知見を更新する」に「計算書を使う人向けの説明は structural-webpier の checks.md にある。変えたらそちらも直す」を足した（webpier-jrsnap・webpier-aggrese も）。webpier-capacita の「structural-webpier（Phase 7 で作る）へ移す予定」を直した。

改名（§10、利用者の判断）：`foundation-check` → `webpier-foundation`、`footing-check` → `webpier-footing`、`cantilever-check` → `webpier-cantilever`（`git mv`）。`tests/`・`webpier/` に同じ語があるが、一時フォルダーの名前（`mktemp("footing-check")`）と一般の語（"foundation-check resistance tables"、"no foundation-check test was read"）でスキル名ではないので、ソースは変えず品質ゲートも要らなかった。CLAUDE.md・README・CONTEXT.md・`.claude/docs` にスキル名の参照はなかった。

## 移した記述

| 元 | 移した先 |
|---|---|
| 桑園 `jrsnap-ndu-edit/references/sect-frange-jiku.md`（全文） | 桑園 `slab-shear-summary/references/ndu-sect-frange-jiku.md`（`git mv`、冒頭に「案件の記録、一般の意味は structural-jrsnap-ndu」の段落、`input-sources.md`・`ndu-section-material-geometry-rebar.md` へのリンクを直した） |
| 桑園 `jrsnap-ndu-edit/references/section-material-geometry-rebar.md`（全文） | 桑園 `slab-shear-summary/references/ndu-section-material-geometry-rebar.md`（同上。`tension-side.md`・`ndu-sect-frange-jiku.md` へのリンクも） |
| 桑園 `jrsnap-ndu-edit/SKILL.md` の案件の規則（L3 の形状コード15の要約、転記の記録、Mdmax の符号の規則） | すでに `slab-shear-summary` の SKILL.md・`input-sources.md`・`tension-side.md` にある。SKILL.md に2つの記録とグローバルの `structural-jrsnap-ndu` への1行を足した |
| 桑園 `slab-shear-summary` の `calculation.md`・`tension-side.md` の `../../jrsnap-ndu-edit/references/…` へのリンク | 移した先のファイルへ |
| Batch `Batchテスト/版別サンプル_保存状況.md` の `../.agents/skills/jrsnap-input-open-save/SKILL.md` へのリンク（以前から切れていた） | 「structural-mcp のスキル structural-jrsnap-input（open-save.md）」 |
| structural-mcp `structural-webpier/references/checks.md` の開発用スキル名 | 新しい名前（旧名を併記） |

## 確認を取った操作（いつ・何を・利用者の返事・結果）

| いつ | 何を | 返事 | 結果 |
|---|---|---|---|
| 2026-10-19 | 26_関内：10本の削除、CLAUDE.md の古い注意を消して1行、AGENTS.md に1行、commit | 可 | ✅ 関内 `6861bbc`。CLAUDE.md は別のセッションが同時に編集中だったので、自分の段落だけを `git apply --cached` で index に入れて commit した（相手の変更は作業ツリーに残っている） |
| 2026-10-19 | 26_桑園高架橋：references 2つを slab-shear-summary へ `git mv`・リンクの修正、jrsnap-* 4本の削除、AGENTS.md、commit | 可 | ✅ 桑園 `512cad2` |
| 2026-10-19 | Batch：sasa/dev で jrsnap-* 3本を削除・commit・GitLab へ push・structural-mcp の pointer の更新 | 可 | ✅ Batch `c15b3c4`（`9c70f54..c15b3c4` を push）。pointer は structural-mcp の Phase 8 の commit |
| 2026-10-19 | WebPier：開発用スキルは削らず structural-webpier への参照を足す・commit・push・pointer | 可 | ✅ WebPier `2652cad`（push 済み）。pointer は同上 |
| 2026-10-19 | 26_上越新幹線：未追跡の `.claude/skills/jrsnap-*` を削除し、追跡済みの `.agents/skills/jrsnap-*` の削除だけを commit。**CLAUDE.md・AGENTS.md は作らない**。移動のほかの部分は触らない | 可（CLAUDE.md なし） | ✅ 上越 `1ad5d30`（`git commit --only .agents/skills/jrsnap-*`） |
| 2026-10-19 | `jrsnap-operator`（操作説明書 PDF など、スキルではない）の扱い | **今回は残す** | 対象外として記録 |
| 2026-10-19 | WebPier の `foundation-check`・`footing-check`・`cantilever-check` を改名するか（§10） | **3本とも改名する**（`webpier-foundation`・`webpier-footing`・`webpier-cantilever`）。参照を直して品質ゲートを通す | ✅ スキルのファイルだけの変更で済み、品質ゲートは不要だった（上の「WebPier」） |

## 読み込みの確認（2026-10-19）

新しいセッションに「使えるスキルの名前をすべて」と聞いた（scratchpad の `verify/run.sh`。Claude Code は `claude -p --strict-mcp-config --mcp-config <空>`、Codex は `codex exec --ephemeral --sandbox read-only -m gpt-6-luna -C <dir>`）。

| どこで | Claude Code | Codex |
|---|---|---|
| 26_関内 | ✅ structural-* 7本。消した10本は出ない（案件の evpit-* などは出る） | ✅ structural-* 7本。古いスキルは出ない（`.agents/skills` がないので案件のスキルも出ない） |
| 26_桑園高架橋 | ✅ structural-* 7本（案件のスキルは `.agents/skills` なので出ない） | ✅ structural-* 7本と `jrsnap-slab-shear-summary`。jrsnap-* 4本は出ない |
| WebPier | ✅ structural-* 7本と開発用 webpier-aggrese・-cantilever・-capacita・-footing・-foundation・-jrsnap・pier-report-style（旧名 foundation-check などは出ない） | ✅ structural-* 7本（WebPier に `.agents/skills` はない。§10） |

## 設計の考え方と背景

- 桑園の案件の記録は書き直さず、ファイルごと `slab-shear-summary/references/` へ移す（`git mv`）。記録は経緯そのものなので、要約すると失われる。一般のキーの意味はグローバルの structural-jrsnap-ndu を正とする1行を冒頭に足す。
- WebPier の開発用スキルは削らなかった。HANDOFF は「利用者向けの使い方の部分だけ消す」としていたが、読んでみると使い方だけの節はなく、式の要約の重なりは開発に要る。二重管理の害（片方だけ直る）は、各スキルの「知見を更新する」に「structural-webpier も直す」と書いて防ぐ。
- 案件の CLAUDE.md・AGENTS.md の1行は、既存の注意の節（関内 CLAUDE.md）・入口の節（関内 AGENTS.md）・NDU の節（桑園 AGENTS.md）に置き、その文書の言語（AGENTS.md の関内は英語）に合わせた。

## 新しく分かったこと

- **26_桑園高架橋 のスキルは `.agents/skills/` にある**（`.claude/skills/` ではない。HANDOFF の表は場所を書いていない）。Claude Code は `.agents/skills` を読まないので、桑園の案件のスキルは Codex にだけ見えている。
- `slab-shear-summary` の frontmatter の `name` は `jrsnap-slab-shear-summary`（フォルダー名と違う）。
- **26_上越新幹線(固有周期) では `.agents/` → `.claude/` の移動が未コミット**で、`.claude/` は未追跡。CLAUDE.md・AGENTS.md がない。
- **`jrsnap-operator`（JRSNAP の操作説明書の PDF 12冊とマニュアル比較のレポート・画像・スクリプト）** が Batch（`.claude/agents/`、追跡）、26_関内（`.claude/agents/`）、26_桑園高架橋（`.agents/agents/`、追跡）、26_上越新幹線（`.claude/agents/`）にある。スキルではない（一覧に出ない）ので Phase 8 の表にない。桑園の `section-material-geometry-rebar.md`・`sect-frange-jiku.md` はこの PDF のページへリンクしている。
- Batch の submodule は detached HEAD（`9c70f54`）。`sasa/dev` も同じ commit。

## Tips

- コピーの比較：`cmp.sh <skills dir> <skill> <WebPier の rev>`（scratchpad）。各ファイルを `tr -d '\r' | md5sum` で WebPier の `git show <rev>:<path>` と比べ、片方にしかないファイルも出す。
- 別のセッションが同じファイルを編集中のときに自分の部分だけ commit する：`git diff <file>` から自分の hunk だけを取り出したパッチを `git apply --cached` で index に入れ、`git commit`（`--only` はファイル全体を入れてしまう）。
- 改行を保った置き換え：scratchpad の `edit.mjs <plan.json>`（ちょうど1回ある文字列の置き換え、全部の置き換え、末尾への追記。ファイルが CRLF なら CRLF で書く。BOM があれば止まる）。
- `rm -rf $(…)` は Claude Code の安全検査で止まる。消すパスは文字どおりに書く。

## ほかの作業者へ

- ✅ 案件の repo の commit を push した（2026-10-19、利用者の指示「残っていることをやって」）：26_関内 `32ab410..fe04335`（別のセッションの commit `eea92b6`・`fe04335` も一緒に push された）、26_桑園高架橋 `b9b3344..1ed0e31`、26_上越新幹線 `2386abe..0a9e4cf`。structural-mcp の `sassa/skills` も GitHub へ push した（Phase 3〜8 の commit。main への取り込みはしていない。submodule の pointer の commit はすべて各リモートにあることを確かめてから）。
- 26_関内 は別のセッションが CLAUDE.md・CONTEXT.md・`.claude/docs/DESIGN.md`・`.claude/skills/evpit-design/SKILL.md`・EVピット部 を編集中（0510 底版）。Phase 8 の commit は `6861bbc` の自分の変更だけ。
- ✅ 26_上越新幹線 の `.agents/` → `.claude/` の移動を commit した（`da19df7`、利用者の判断で 2026-10-19 の geology-column-log-analyze の更新と no453 の資料も含めた。121 ファイルは内容のまま）。移したスキルの中の `.agents/skills/geology-column-log-*` のパスを `.claude/skills/…` に直した（`0a9e4cf`）。`outputs/no453-analysis-20261019/` と `sdc2ndu/scripts/sdc_converter_app.py` の変更は別の作業なので commit していない。`sdc2ndu/` の中には別の `.agents/skills/sdc-ndu-format` がある（触っていない）。CLAUDE.md・AGENTS.md はない（利用者の判断で作らない）。
- 26_桑園高架橋 の案件のスキル `slab-shear-summary`（name は `jrsnap-slab-shear-summary`）は `.agents/skills` にだけあるので Codex にしか見えない。**利用者の判断で今のまま**（Codex 専用）。
- ✅ 26_桑園高架橋 の `slab-shear-summary/references/` の切れていたリンクを直した（`1ed0e31`）：`L3/総括表.xlsx` は `dd5351e` で `L3/L3総括表.xlsx` に改名されていた（4か所）。support-condition-c2.md の Aggre-SE のソースは `C:/Users/sasai/Documents/structural-mcp/Batch/…` に（行番号が同じ箇所を指すことを Batch `c15b3c4` で確かめた）。
- `jrsnap-operator`（JRSNAP の操作説明書 PDF とマニュアル比較）は Batch・関内・桑園・上越に残した（利用者の判断）。桑園の NDU の記録がこの PDF のページへリンクしている。
- Batch の submodule は `sasa/dev` にいる（Phase 8 の前は detached HEAD）。
