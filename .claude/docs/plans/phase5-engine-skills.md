# Phase 5：JRSNAP・Capacita・FEMPython・SoilStructure のスキル

- 状態: 完了（2026-10-19）
- 更新日: 2026-10-19
- 親の計画: global-engine-skills-plan.md の Phase 5
- 型: phase2-aggrese-skill-split.md（エンジンは structural-*、WebPier の決定・実装・受入は webpier-*、受入が固定している WebPier の scripts は動かさず複製を置く）

## 作業項目

- ✅ JRSNAP のコピーの差分を取る（WebPier・26_関内・26_桑園高架橋・Batch submodule、計画にない 26_上越新幹線(固有周期) も）
- ✅ `structural-jrsnap-input`・`-figures`・`-ndu`・`-soil` を作る（scripts は複製）
- ✅ WebPier に `webpier-jrsnap` を作り、WebPier の `jrsnap-*` を消す（受入の補助 `jrsnap-input-open-save/scripts/` は残す）
- ✅ `capacita-column-check` の2版を比べ、`structural-capacita` と `webpier-capacita`（改名）に分ける
- ✅ FEMPython・SoilStructure を作るかを判断する（作らない。下の「設計の考え方」）
- ✅ `npm test`（55件すべて成功）、`skills:install`・`skills:status`（6本とも両方に `link`）
- ✅ 読み込みの確認（下の「読み込みの確認」）
- ✅ commit（structural-mcp、WebPier）と親の計画書の更新

## 調べたこと（コピーの差分、2026-10-19）

改行を除いた md5 で比べた。

| スキル | WebPier | 26_関内 | 26_桑園高架橋 | Batch | 26_上越新幹線 |
|---|---|---|---|---|---|
| jrsnap-input-launch | 新 | 新（`aggrese-project` への参照だけ違う。WebPier は Phase 2 で直した） | 旧 | 旧（桑園と同一） | 旧（桑園と同一） |
| jrsnap-input-open-save | 新 | 新 | 旧 | 旧 | 旧 |
| jrsnap-soil-analysis | 新 | 新 | 旧 | 旧 | 旧 |
| jrsnap-ndu-edit | 新（reference 1つ追加） | 新 | 旧 | なし | さらに古い（桑園の部分集合） |
| jrsnap-data-check・-load-diagram | あり | 同一 | なし | なし | なし |
| scripts（9件） | 5か所すべて同一 | | | | |

- 旧系統（桑園・Batch・上越）にしかない記述はなかった。違いはパスの書き方（`C:\Users\sasai\Documents\Batch` を起点にした相対パス／`.agents\skills\…`）だけ。新系統（WebPier）を基準にした。
- `capacita-column-check`：WebPier 版（77行）は 26_関内 版（68行）の上位互換。関内版にない「片持ち梁の断面照査（0910）」の節と、Dmax の出どころ（`鉄筋.柱` → `鉄筋.フーチング`）の訂正がある。関内版にしかない記述はない。
- 見本データ `tests` は Batch submodule の中で追跡されている（151 ファイル）ので、スキルは「開発機のみ。structural-mcp の repo のルートから `Batch/tests/…`」と書ける。

## 対応表（元 → 移した先）

E＝structural-mcp の `skills/`、W＝WebPier の `.claude/skills/`、案件＝26_桑園高架橋 のコピーに残る（この Phase では消さない）。

| 元 | 移した先 |
|---|---|
| jrsnap-input-launch：起動の cmd 行・注意・2026-10-11 の確認 | E `structural-jrsnap-input/references/open-save.md` |
| 同：`run-analysis.ps1` の使い方・自動応答・ライセンス・根拠・実機確認 | E `structural-jrsnap-input/SKILL.md`（サンプルの絶対パスは置き換え語に） |
| 同：基礎照査機能（S_SubstCheck）の CSV | E `structural-jrsnap-input/references/engine.md`。「WebPier の NDU はこのデータを持たない」は W `webpier-jrsnap` |
| 同：JRSNAPHeadless（run、`--analyze false`、自動応答の違い、jrsnap-headless.json、mutex） | E `structural-jrsnap-input/SKILL.md`（JRSNAPHeadless 9e3c8fe の `.ndt` 入力を README から追記）。「WebPier の 0711・0721 が呼ぶ（決定47）」は W |
| 同：figures の概要と bin\Release の作り直し | E `structural-jrsnap-figures`、作り直しの経緯は W |
| 同：解析エンジンの画面と結果ファイル | E `engine.md`。「0720 Case1 の CASE-6 が 0（決定51）」の例は W、一般の事実は E `ndt-export.md` |
| jrsnap-input-open-save：操作・一括保存・形式制限・`-ConvertS6`・根拠 | E `structural-jrsnap-input/references/open-save.md` |
| 同：解析用データ出力を画面なしで行う仕組み | E `structural-jrsnap-input/references/ndt-export.md` |
| jrsnap-soil-analysis：全部 | E `structural-jrsnap-soil`（サンプルは `Batch/tests/…`） |
| jrsnap-ndu-edit：編集前・Shift-JIS・検証・知見の規則 | E `structural-jrsnap-ndu/SKILL.md` |
| 同：L3 総括表への転記、Mdmax の符号で引張側の主筋を選ぶ規則、`jrsnap-slab-shear-summary` へのリンク | 案件（26_桑園高架橋）。E には「転記側の規則は案件の判断で、NDU の配筋を変える指示ではない」だけ |
| ndu-edit/references/sect-frange-jiku.md：形式・フィールドの意味・正規表現・上下と左右の判定 | E `structural-jrsnap-ndu/references/section-fields.md`・SKILL.md |
| 同：L3・L4・C1-1・C2-2・C3-2 の編集の記録（件数・値の表） | 案件 |
| ndu-edit/references/section-material-geometry-rebar.md：キーとフィールドの表、換算、段の選び方、有効高さ、表2-33・図2-70 | E `section-fields.md` |
| 同：総括表 `M-φ` のセル（E47 など）、L3 諸元.xlsx、せん断スパンを内法長の 1/2 とする方針 | 案件 |
| ndu-edit/references/example-pier2-seismic-verification.md | W `webpier-jrsnap/references/`（`git mv`、冒頭に1行追記）。NDU の一般的な性質（直接基礎の支点、CHOKU_KISO、旧版の保存で足される7項目、5.2 の読込の制約）は E `structural-jrsnap-ndu/references/ndu-format.md` にも |
| jrsnap-data-check：対象・図の名前の表・図の追加・作画条件・ヘッダー・確かめ方 | E `structural-jrsnap-figures/SKILL.md` |
| 同：WebPier での使われ方（決定50）、代役 `fake_runner.py` | W `webpier-jrsnap` |
| 同：ReportHost の共通の仕組み・別の帳票アプリを足すとき | E `references/report-host.md`（「0710 で1回」は W） |
| 同：S_DataCheck に固有のこと・落とし穴 | E `references/data-check.md`（「見本 5.1 の外形の枠」は W、一般の事実は E） |
| jrsnap-load-diagram：対象・ケースと組合せ・figures --load-diagram・5.3 の制限・作画条件 | E `structural-jrsnap-figures/SKILL.md` |
| 同：手順（INI の切り離し、NDT の読込、画面の答え方、ページ、終わり方、BUSY）、確かめ方、5.2 の IL | E `references/load-picture.md` |
| 同：0710 CASE-1 の文字の重なり、いまの WebPier の NDT の性質、0720 の 480、WebPier での使われ方（決定51）、受入、計算書の確かめ方 | W `webpier-jrsnap` |
| capacita-column-check：WDJ の落とし穴（shape、整数、steel、position、着目点の番号、断面力一覧、result.json、conditions_list、γi、旧 WebDan との耐力差） | E `structural-capacita/SKILL.md`・`references/wdj.md`。見本の値（Mud 37449.1 など）と point_index・0620 の 7 は W |
| 同：手で試す（runner、pymupdf） | E `references/develop.md`。WebPier の生成・`point_index`・受入は W |
| 同：直すとき（ビルド、UiTests、以前から落ちるテスト） | E `references/develop.md`。WebPier の `pipeline/capacita.py`・代役は W |
| 同：WD-1901〜1913 の意味とコードの出どころ、耐久性の曲げは省略しない | E `structural-capacita/SKILL.md`。0621 で 1901・1906 が出る、OMITTED の印刷は W |
| 同：側方鉄筋の既定（CalcDefaultUedgeAndPitchForSideBar）、安全性の曲げは側方鉄筋を数えない | E。直角方向の芯の値・見本との差は W |
| 同：断面力入力モード（force[] のキー、id、返る節、WD-408〜410、La は着目点ごと、rebar1 null、疲労の ΣN） | E `references/wdj.md`。0910・0810・0820 の具体は W |
| 同：0611・0621・0910・0810・0820 の実装・決定・受入・見本の値 | W `webpier-capacita`（`git mv`） |
| 同：Aggre-SE の PIK を Capacita に渡すとき | E `wdj.md`（一般）と W（決定57、番号の範囲） |

## 設計の考え方と背景

- 親の計画書 §3 の4本の JRSNAP スキルにした。`structural-jrsnap-input` は launch と open-save と JRSNAPHeadless の `run` をまとめた（どれも「入力を開く・書き出す・解析する」で、scripts が `$PSScriptRoot` で互いを読むだけなので1つのフォルダーに入る）。
- JRSNAPHeadless の内部（ReportHost、S_DataCheck・S_LoadPicture の操縦）はエンジンの層に入れた。JRSNAPHeadless は Phase 3 で structural-mcp の submodule になる予定なので、ソースは「structural-mcp の repo のルートから `JRSNAPHeadless/`」と書いた。いまは git 管理外であることも書いた。
- 26_桑園 の案件の記録（L3 などの編集履歴、総括表のセル）はグローバルに入れなかった。フィールドの意味のように案件に依らない事実だけを取り出し、「ある案件の高架橋の梁で観測」と確認範囲を残した。桑園のコピーは Phase 8 まで残るので、記録は失われない。
- WebPier の `jrsnap-*` は、Phase 2 と同じくこの Phase で WebPier 固有の部分を `webpier-jrsnap` に移して消した（親の計画書 §6 Phase 8 の表では Phase 8 の作業だったが、WebPier の中で同じ知識が二重にならないように前倒しした）。ただし `jrsnap-input-open-save/scripts/` は `scripts/accept_jrsnap_ndu.py` の `HELPER`、`tests/fixtures/acceptance/jrsnap_v52/record.json` の SHA、`.gitattributes`、WebPier の CLAUDE.md・README.md が参照しているので残し、SKILL.md の代わりに README.md（スキルではないこと、正はどこか）を置いた。
- `capacita-column-check` は `webpier-capacita` に改名（親の計画書 §10）。0611・0621 の利用者向けの説明は Phase 7 で `structural-webpier/references/checks.md` へ移すまで `webpier-capacita` に置く。
- FEMPython・SoilStructure のスキルは作らなかった。どの案件（K: の各案件、WebPier）にも、それらのエンジン自体の知識を持つスキルがない（WebPier のスキルが FEMPython の PIK の並びに触れる程度で、それは `structural-capacita` の wdj.md に入れた）。MCP のツール説明・README・`soilstructure_get_schema`・`fempython_get_runner_contract` で足りている。案件のセッションで同じ説明を繰り返すようになったら作る。
- MCP のツールがある操作（Capacita の inspect/validate/compose/calculate）は MCP を先に案内した。JRSNAP は MCP のツールがない（§10 で作らないと決めた）ので runner を直接呼ぶ。

## 読み込みの確認（2026-10-19）

| どこで | クライアント | 結果 |
|---|---|---|
| P7橋脚（案件のスキルなし） | `claude -p` | ✅ 「5.3.1.S.6 の .ndu は 5.2-L03 で開けるか」に S.5 が上限・`-ConvertS6` の手順で、「`shape: "矩形"`」に WD-1001・`"1"` に直す・WD-9999・WDJ-FORMAT-CONFLICT・position で答えた |
| P7橋脚 | `codex exec`（gpt-6-luna、high） | ✅ 同じ内容。`structural-jrsnap-input` の open-save.md と `structural-capacita` の wdj.md を読んだと答えた |
| WebPier | `claude -p` | ✅ 一覧に structural-aggrese・-capacita・-jrsnap-figures・-jrsnap-input・-jrsnap-ndu・-jrsnap-soil と webpier-aggrese・-capacita・-jrsnap の9本 |

Codex の low・medium は本文を開かずに答えることがある（Phase 2 の記録）ので high で確かめた。

## 新しく分かったこと

- **5つ目のコピー**：`K:\ニュージャパンコンサルタンツ\26_上越新幹線(固有周期)\.claude\skills` に jrsnap-input-launch・-open-save・-ndu-edit・-soil-analysis がある（親の計画書 §2.1 の表にない）。桑園と同じ旧系統で、ndu-edit は桑園よりさらに古い。ほかにない記述はない。Phase 8 の片付けの表に加える。
- **Capacita のせん断スパン La の単位は mm**（2026-10-19、調査して確定）。
  - コード：計算（`Capacita/RcDan/CalcResult/CalcResult_ShearCapacity.cs` の「せん断スパン長La(mm)」）はせん断スパン比を `La / 有効高さ d（mm）` で求め、自動算定の値も `|1000 × Md / Vd|`（mm、`ModelDataForCalc.GetShearSpan`）、計算書の印字も「せん断スパン長 (mm)」。読み取り側の `OrganizedInputData/MemberGroup.cs:367` のコメント「(m)」が誤りで、最初はこれを見て m と書いてしまった。
  - `La` がちょうど 1.0 のときは「自動算定」（`CommonDataClass.cs` の `ShearVerification`）。旧 WebDan の見本の `points[0].La: 1` はこの意味だった。
  - 本物の runner（Release、markdown 出力）で、WebPier の `post/` の WDJ の La だけを変えた複製を比べた（scratchpad の `la/`）。
    - フーチング（`post/線路方向フーチング.wdj`、La 1096・1942 mm）：mm のままが正しい（せん断スパン比 0.422・0.747、Vdd 4374.7・3307.1 kN）。m にすると比 0.000・0.001、βa 5.000、Vdd 5152.1 kN になる。**0810・0820 は正しい**。
    - 片持ち梁（`post/片持ち梁.wdj`、La 1.55）：いまの値では「せん断スパン長 (mm) 1.6」「比 0.001」で βa が上限 5.000、安全性（破壊）の Vdd 15179.9 kN・照査値 0.415。1550 にすると比 0.603、βa 3.668、Vdd 11134.6 kN・照査値 0.566（ほかの2つの照査も 0.382→0.520、0.383→0.522）。**0910 は耐力を約36%過大に見積もっていて、安全側でない不具合**。`webpier/export/capacita/cantilever.py` が `check.shear_span`（m、`LENGTH`）をそのまま `La` に書いているのが原因。
    - 柱（0611・0621）の WDJ には `shear` の表がないので影響しない。
  - スキルは `structural-capacita`（La は mm、1 は自動算定）、`webpier-capacita`・`cantilever-check` に反映した。
  - **0910 を直した**（2026-10-19、利用者の指示）：WebPier の `export/capacita/cantilever.py` が La を mm（`_millimetres`、1.55 m → 1550）で書く。計算（`calc/cantilever/check.py` の `shear_span`）は m のまま。テスト `tests/export/test_cantilever_wdj.py` の期待値を 1550（int）に、`tests/fixtures/example2/cantilever_notes.md` と WebPier の `refactoring-decisions.md` の決定59に経緯を書いた。0910 に受入記録はない。それより前に作った `post/片持ち梁.wdj` と 0910 の計算書は作り直しが要る。
- JRSNAPHeadless に `run --input <.ndt>`（書出しを飛ばして `.ndt` を直接解析する入口）が加わっている（9e3c8fe）。元のスキルにはなかったので、README から `structural-jrsnap-input` に足した。
- MCP の `webdan_calculate` は `--pickup` を公開していない。WebPier は runner を直接呼んでいる。
- `run-analysis.ps1` などの `.ps1` は UTF-8 の BOM 付き（日本語の文字列を Windows PowerShell 5.1 が読むため）。テストの BOM の検査は `.md` だけなので問題ない。scripts はバイト列のまま複製した。

## Tips

- コピーの比較は `tr -d '\r' < file | md5sum` で改行を除いて行う（作業ツリーは CRLF、git の保存版は LF のことが多い）。WebPier の版は `git -C WebPier show HEAD:<path>` で取る。
- 他のスキルのファイルを本文で書くときは、`` `scripts/…` ``・`` `references/…` `` と書かない（テストが自分のスキルのフォルダーで実在を検査する）。「スキル `structural-x` の y.md」と書く。

## ほかの作業者へ

- ✅ WebPier のフーチングの WDJ の La の単位：mm で正しい（上の「新しく分かったこと」）。
- ✅ 0910 の片持ち梁の WDJ が La を m で書いていて耐力を過大に見積もっていた件は、WebPier で直した（上の「新しく分かったこと」）。
- ✅ WebPier を Codex で開いても WebPier のスキル（`webpier-*` など）は見えない（`.agents/skills` がない。Phase 2 の記録）。**決定（2026-10-19、利用者）：WebPier の開発に Codex は使わない（Claude Code だけ）。** WebPier に `.agents/skills`・`AGENTS.md` は作らない。設計案件の作業は WebPier の repo を開かず、グローバルの `structural-*` と MCP で行うので影響しない。
- Phase 8 の片付けで、26_桑園高架橋 の `jrsnap-ndu-edit` を消す前に、L3 などの編集の記録と総括表の転記の規則を、桑園の案件のスキル（`slab-shear-summary` など）へ移すこと。
- 26_関内 の `capacita-column-check`・`jrsnap-*` と Batch submodule の `.agents/skills/jrsnap-*` は、この Phase では消していない（Phase 8）。
- WebPier の `.claude/docs/plans/jrsnap-load-diagram-plan.md` は、消したスキル `jrsnap-data-check`・`jrsnap-load-diagram` の名前を経緯として書いている（スキル以外のファイルなので直していない）。
