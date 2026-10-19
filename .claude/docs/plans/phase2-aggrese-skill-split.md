# Phase 2：Aggre-SE のスキルを structural-aggrese と webpier-aggrese に分ける

- 状態: 完了（2026-10-19）。残り：WebPier を Codex で開いたときに webpier-aggrese が見えない件（「ほかの作業者へ」）
- 更新日: 2026-10-19
- 親の計画: global-engine-skills-plan.md の Phase 2
- 引継ぎ元: HANDOFF.md

## 作業項目

- ✅ 元のスキルと参照元を読み、箇条ごとの対応表を作る
- ✅ skills/structural-aggrese/ を作る（SKILL.md、references/、scripts/）
- ✅ npm test を通す（45 件すべて成功、2026-10-19）
- ✅ WebPier の aggrese-project を webpier-aggrese に改名して絞る。参照元を直す
- ✅ skills:install と、claude -p・codex exec で読み込みを確かめる（結果は「読み込みの確認」）
- ✅ commit（structural-mcp、WebPier）と親の計画書の更新

## 対応表（元の箇条 → 移した先）

元：`WebPier/.claude/skills/aggrese-project/SKILL.md`（WebPier f64e060、md5 `f0637981de75…`）。E＝`skills/structural-aggrese/`、W＝`WebPier/.claude/skills/webpier-aggrese/SKILL.md`。E の中は S＝SKILL.md、X＝references/project-xml.md、O＝references/outputs.md、F＝references/foundation-steps.md。

| 元の節 | 元の箇条 | 移した先 |
|---|---|---|
| 冒頭 | Aggre-SE は JRSNAP の結果を XML の照査条件で集計・照査する | E/S 冒頭 |
| 冒頭 | WebPier が 0711・0721 で XML を書く（決定49、export/aggrese、CONTEXT.md） | W 冒頭 |
| 冒頭 | report.pdf をバイト列のまま計算書にする（決定56、ADR-0009、aggrese.py） | W 冒頭 |
| 冒頭 | Batch のソースの場所 | E/S（repo のルートから `Batch/Aggre-SE/`）、W 冒頭（`Batch/`）。絶対パスは削除 |
| 冒頭 | Batch を変更しない、複製で試す | E/S、W 冒頭 |
| 読む | 宣言 utf-16・中身 Shift-JIS・CRLF | E/S「読む」 |
| 読む | `iconv … uniq -c` | E/S「読む」 |
| 読む | Python の `ET.fromstring` | E/S「読む」 |
| 読む | クラス・画面の文言・DataLoad/DataSave の場所、VB は UTF-8（BOM 付き、38件） | E/X「ソースの場所」 |
| 項目と画面の対応 | 表の11行（CaseName〜Version） | E/X の表（`_rbJIban` の行に MCP の `spectralDuctility` を追記） |
| 項目と画面の対応 | 配列の長さ（50件、古い見本は101件） | E/X「配列の長さ」 |
| DB1 の横 | 同じ名前の全ファイル、`.xlsx`・`.csv` は Batch の出力 | E/S（`.DB2` を例に追記） |
| DB1 の横 | `_Output_Chokukiso.csv` は `S_SubstCheck.exe` が書く、条件、なければ DB1 から求める（SNAPClass.vb） | E/S |
| DB1 の横 | WebPier の 0711 で試すと作用は一致・抵抗は違う、Df・γ2 の差が混ざる（決定49の既知の差） | W「書出しを直すとき」。E/S には一般的な事実（基礎照査の値と DB1 から求めた値は一致しないことがある）だけ |
| DB1 の横 | `_Output_PIC.csv`・`_直接基礎照査No1.csv` は読まない | E/S |
| DB1 の横 | `Aspect-SE_*.csv` | E/S |
| runner で複製を確かめる | runner の場所と README | E/S「MCP で」（`get_environment_template`・環境変数）と「runner を直接呼ぶ」。絶対パスは削除 |
| runner で複製を確かめる | 複製と `--snap-map` の形 | E/S「runner を直接呼ぶ」 |
| runner で複製を確かめる | `inspect`・`run` のコマンド | E/S「runner を直接呼ぶ」 |
| runner で複製を確かめる | 成功の見方、`engineeringStatus` は not_evaluated、OK/NG は report.pdf | E/S「runner を直接呼ぶ」 |
| 保存し直す | roundtrip.cs の動き | E/S、道具の複製は E の `scripts/` |
| 保存し直す | csc のコマンド | E/S（スキルのフォルダーと runner のフォルダーを置き換え語で） |
| 保存し直す | csc は PowerShell から | E/S |
| 保存し直す | 保存し直すと変わる書式 | E/S |
| 保存し直す | WebPier の書出しはバイト列が変わらないことを受入にしている | W「書出しを直すとき」（E/S には一般的な使い方として） |
| 保存し直す | テストの期待値 `tests/fixtures/example2/aggrese/`、`notes.md` | W |
| WebPier の書出しを直すとき | 入力は耐震設計条件だけ、writer.py の定数 | W |
| WebPier の書出しを直すとき | Batch の版が変わったら（BATCH_VERSION、受入の取り直し） | W（見本を保存し直して差を見る部分は E/S にも） |
| WebPier の書出しを直すとき | 受入記録 `record.json`、`tests/acceptance` | W |
| 0711・0721 | WebPier の呼び出しの引数、返る4つ、`.env` | W（`--foundation-steps true` と5つ目を追記。`aggrese.py` の `ARGUMENTS` で確認） |
| 0711・0721 | 1方向 4 秒ほど | E/S、W |
| 0711・0721 | runner は DB1 のフォルダーに何も書かない | E/S |
| 0711・0721 | WebPier は前後で SHA を比べる | W |
| 0711・0721 | report.pdf の構成（Case ごとに7ページ…） | E/O |
| 0711・0721 | 線路方向11ページ・直角18ページ | E/O（1 Case／2 Case として）、W |
| 0711・0721 | 見出しは `KihonInfo.Title`・`Comment`、`Create荷重変位曲線` | E/O |
| 0711・0721 | 見本の見出しは作成者が書き込んだもので再現しない | W（E/O には「利用者が書き込んだ見出しは再現できない」） |
| 0711・0721 | 帳票は毎回同じバイトにならない | E/O |
| 0711・0721 | pickup.pik の kind・media type | E/O の表 |
| 0711・0721 | WebPier が `post/…_Aggre-SE.pik` に書く | W |
| 0711・0721 | PIK の書式、先頭行、Shift-JIS・CRLF | E/O |
| 0711・0721 | `GetPickUpFile`、`Option_PickUpFileCase` 0 で3つ・>0 で10個、ステップ 0〜の最大・最小 | E/O |
| 0711・0721 | 同じ入力で同じバイト | E/O |
| 0711・0721 | 109行・11 KB、127行・13 KB | E/O（部材の本数で）、W（方向で） |
| 0711・0721 | 部材の番号は JRSNAP の骨組、ITAN・JTAN だけ | E/O |
| 0711・0721 | `post/線路方向.pik` は FEMPython の PIK なので名前を分ける | W |
| 0711・0721 | summary.xlsx の kind・大きさ・4枚のシート | E/O |
| 0711・0721 | zip の日時は固定、GUID・modified が毎回変わる | E/O |
| 0711・0721 | WebPier は `post/…_Aggre-SE.xlsx` に書き、zip であることだけ確かめる、受入はシート名 | W（シート名で検査することは E/O にも） |
| 0711・0721 | 成果物は引数で決まる、`summary.outputs` | E/O |
| 0711・0721 | WebPier は成果物の組が一致しないと止める | W |
| 0711・0721 | 見本 10.5・10.6 とのページの対応 | W |
| 0711・0721 | 22・23 ページは JRSNAP の基礎照査の出力 | W（E/O には「地盤反力分布図などは JRSNAP の出力で Aggre-SE の計算書に入らない」） |
| 0711・0721 | 見本の版は古く見出しが違う、安全率一覧表はいまの Batch が出す | W、E/O「版による違い」（推定として） |
| 0711・0721 | 見本の PDF は画像、pymupdf で PNG にする | W |
| 0711・0721 | `accept_aggrese_project.py` に runner が要る、helpers の SHA | W |
| 0711・0721 | `accept_aggrese_report.py`、記録、応答値を2ページ目の文字から読む、見本 10-14 と一致 | W（文字の形は E/O にも） |
| 直接基礎のステップ表 | `--foundation-steps` の既定・inspect で拒否・直接基礎のとき CSV・杭では返らない | E/F「出力」「使える版」 |
| 直接基礎のステップ表 | WebPier は常に付けて `post/…_直接基礎.csv`（kind `steps`）、`FOUNDATION_STEPS_COLUMNS` | W |
| 直接基礎のステップ表 | 列とその出どころ（GetChokukisoJoint、ChokukisoVd/Hd/Md、Single、ChokuItem、"R"） | E/F「出力」 |
| 直接基礎のステップ表 | `StepCtrl(istep)` ↔ `ChokuItem(istep+1)` ↔ JRSNAP の番号、初期状態 | E/F「step の番号」 |
| 直接基礎のステップ表 | 見本 10-23 の増分ステップ 31 ＝ step 31（H・M の値） | W（E/F には JRSNAP の出力リストとの一致として、値は省く） |
| 直接基礎のステップ表 | `RvdStep` は `V ≧ Rvd` の最初の step と一致 | E/F |
| 直接基礎のステップ表 | 線路方向 32、直角 33、見本の 31 と違うのは Df／γe2 の既知の差 | W |
| 直接基礎のステップ表 | Rvd 到達後は ChokuItem が固定 | E/F |
| 直接基礎のステップ表 | SNAPDBLib を PowerShell の反射で読む、`.OUT` は読めない | E/F |
| 直接基礎のステップ表 | Batch 側のテスト（PHC で返らない、直接基礎の既定の XML、`summary.outputs`、`aggregated`） | E/F（W には WebPier の `post/線路方向.xml` が使われることだけ） |
| post の出力を作る・確かめる | 作るコマンドと書くファイル | W（`_直接基礎.csv` を追記。`stages.py` で確認） |
| post の出力を作る・確かめる | 最新か確かめる手順 | W |
| post の出力を作る・確かめる | `git commit --only` | W |
| 知見を更新する | 反映すること、確認の区別 | E/S・W の「知見を足すとき」「知見を更新する」（親の計画書 §7 の規則で書き直し） |

新しく足したもの（元にない）：E/S の MCP の流れ（`get_capabilities` → `aggrese_inspect` → `aggrese_calculate`、引数と runner の引数の対応、allowed root、job への複製）、`--spectral-ductility` はファイルのパスで MCP の `caseNumber` は 1 始まり（`src/jobs.ts`）、SNAPDBLib の作業フォルダーによる直列化（README.md）、E/O の kind・media type の表（`AggreSeRunner.cs`）、E/F の「使える版」（9c70f54 と MCP 未公開）。

## 読み込みの確認（2026-10-19、Claude Code 2.1.303・Codex 0.163.0）

`npm run skills:install` のあと `skills:status` で `~/.claude/skills/structural-aggrese`・`~/.agents/skills/structural-aggrese` とも `link`。

| どこで | クライアント | 結果 |
|---|---|---|
| P7橋脚（案件のスキルなし） | `claude -p` | ✅ `structural-aggrese` の `references/project-xml.md` を読み「Ⅰ,Ⅱ両方」 |
| P7橋脚 | `codex exec`（gpt-6-luna、low・medium） | ✖ 一覧には出るが、道具を一度も呼ばず description だけで「先頭の仕様」と誤答（読んだと書くが、セッション記録に読込みがない） |
| P7橋脚 | `codex exec`（gpt-6-luna、medium、「SKILL.md を開いて読んで」と明示） | ✅ references まで読み「Ⅰ、Ⅱ両方」 |
| P7橋脚 | `codex exec`（gpt-6-luna、high、指示なし） | ✅ `structural-aggrese` と `references/project-xml.md` を読み「Ⅰ、Ⅱ両方」 |
| WebPier | `claude -p` | ✅ 一覧に `structural-aggrese` と `webpier-aggrese` |
| WebPier | `codex exec` | △ `structural-aggrese` は出るが `webpier-aggrese` は出ない。WebPier に `.agents/skills` がなく、Codex は `.claude/skills` を読まないため。**分割の前から WebPier のスキルは1本も Codex に見えていない**（jrsnap-* なども出ない） |

- 誤答のあと、description に「添字は画面の並びや 0 始まりの順と違うものがあるので、推測せずこのスキルの表で確かめる」と足した。low ではそれでも開かなかった。推論の弱い設定の Codex は description だけで答えることがある。description には「推測せず本文を見る」理由になる語を入れておく。

## 設計の考え方と背景

- 分け方の基準は親の計画書 §1 の4層。「別の案件で Aggre-SE を使う人が知りたいか」で E と W を分けた。決定番号、`webpier/…` のコード、`post/` のファイル名、見本のページ番号、WebPier の受入は W。
- 同じ事実が両方に関わるとき（例：直接基礎の照査値の差）は、E には案件に依らない一般的な形だけを書き、具体的な値と経緯は W に残した。重複させるのは、W の読者が E を開かずに判断できる最小限（ページ数、行数など）だけ。
- E の SKILL.md は MCP を先に案内し、runner を直接呼ぶ方法は「スクリプトから使うとき」として後に置いた（親の計画書 §3）。詳細は3つの references に分け、SKILL.md は 77 行。
- `aggrese_project_roundtrip.cs` は**複製**を E の `scripts/` に置いた。WebPier の受入（`scripts/accept_aggrese_project.py` の `HELPER`、`tests/fixtures/acceptance/aggrese/record.json` の SHA）が WebPier 側のファイルを固定しているので、WebPier の `scripts/` は動かさない。複製との違いは1行目のコメントの「(decision 49)」を除いたことだけ（エンジンの層に決定番号を入れないため）。
- W は改名（`git mv`）して、WebPier に要る部分を残した。W の冒頭で「Aggre-SE 自体はスキル `structural-aggrese` を参照」と書いた。グローバルのスキルは案件からの相対リンクで辿れないので、名前で参照する。
- WebPier のほかのスキルの参照先：エンジンの話（`_Output_Chokukiso.csv` の読み方、ステップ表の列、runner）は `structural-aggrese`、WebPier の話（決定57 の post のファイル）は `webpier-aggrese`。cantilever-check・footing-check・capacita-column-check・jrsnap-input-launch の4つ。

## 新しく分かったこと

- `--foundation-steps` は Batch の 9c70f54（ブランチ sasa/dev、2026-10-19 17:21）で入った。structural-mcp が固定している Batch は 47d1654 で、その Headless README にも runner にもまだない。MCP の `aggrese_calculate` も公開していない（`src/server.ts`、2026-10-19）。WebPier は `.env` の runner（Batch の作業ツリーで build したもの）で使っている。→ Batch の pointer を進めるときに、MCP に公開するか（`aggrese_calculate` に `generateFoundationSteps` を足す）を決める必要がある。
- runner の `--spectral-ductility` は JSON の文字列ではなく**ファイルのパス**（`RunOptions.cs` の `AbsolutePath`）。MCP は `caseNumber`（1 始まり）を 0 始まりに直して `input/spectral-ductility.json` を書く（`src/jobs.ts`）。
- WebPier は作業の開始時に `sasa/test`（main と同じ f64e060）にいて、途中で `main` に戻っていた。別のセッションがブランチを切り替えている。
- WebPier のスキルのファイルは index では LF、作業ツリーでは CRLF（`core.autocrlf`）。`.gitattributes` で固定されているのは `jrsnap-input-open-save/scripts/` だけで、ほかのスキルは受入のハッシュの対象外。WebPier の `tests/`・`scripts/`・`webpier/` に `aggrese-project` の参照はない。

## Tips

- 元のスキルの md5 は `git -C WebPier show HEAD:<path> | md5sum` で取る（作業ツリーは CRLF なので値が違う）。
- CRLF のファイルの一部を書き換えるときは、Node で読んで `replace` して書き戻すと改行が保たれる（置換の対象がちょうど1回あるかを数えてから）。
- `skills/` の Markdown で `` `scripts/…` ``・`` `references/…` `` と書くと、テストがスキルのフォルダーからの実在を検査する。WebPier の `scripts/` のファイルは E に書かない（書くなら W）。

## ほかの作業者へ

- WebPier に新しく加わった `footing-check`・`cantilever-check` は、親の計画書 §2.1 の表にない。どちらも WebPier の段階（0800〜0820、0900・0910）の照査で、Aggre-SE の総括表・ステップ表と Capacita を使う。Phase 5・7 で「WebPier の使い方（`structural-webpier/references/checks.md`）」と「開発（`webpier-footing`・`webpier-cantilever` など）」に分ける対象になる。
- **WebPier を Codex で開いたとき、WebPier のスキルが見えない**（上の確認）。直すなら WebPier に `.agents/skills`（`.claude/skills` と同じものを Codex にも見せる仕組み）が要るが、WebPier のスキル以外の構成を変えるので、この Phase ではしていない。利用者の判断待ち。
- 案件 26_関内 の `.claude/skills/aggrese-project` はこの Phase では消していない（Phase 8）。
