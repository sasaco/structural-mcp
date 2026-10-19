# 解析エンジンの画面・結果ファイル・基礎照査機能

## 解析エンジン（S_ANALYSIS.exe）の画面と結果ファイル（2026-10-18 確認）

- `S_ANALYSIS.exe` の窓（「解析結果の保管中・・・」「耐力と変形性能の自動算定」「Vepp（耐力・変形性能算定）」「解析状況」「解析機能」）は WinForms（クラス `WindowsForms10.Window.8.app...`）で、`#32770` ではない。標準のメッセージボックスは、複数解析の完了通知「解析が全て終了しました。」（題名 `解析実行`）で、5.2・5.3 とも同じ。
- 自動算定の窓のチェックボックスは `BM_GETCHECK` に答えない。状態を読むには UI Automation の `TogglePattern` を使う。初期状態では「ＲＣ・ＰＨＣ部材」だけがオン。
- 複数解析では、5.2-L03 でも 5.3 と同じく「Vepp」「解析状況」の窓と完了通知だけが出て、自動算定と基礎照査の確認は出なかった。結果の横に 0 バイトの `解析実行Err.log` もできる。
- `.OUT`・`.DSP`・`.KG*`・`.R10` など結果ファイルの多くは暗号化された zip（先頭が `PK`）で、同じ入力でも毎回バイト列が変わる。結果の同一性をハッシュで比べない。DB1 の中身を読むには SNAPDBLib を使う（スキル `structural-aggrese` の foundation-steps.md）。
- `S_ANALYSIS.exe` は実行のたびにインストール先の共用ファイル（`danmen.fil`・`nrwork.dir`・`JikuFact.INI`・`exit_flg*.out` など）を書き換える。同じインストール先では解析を同時に走らせない。

## 基礎照査機能（S_SubstCheck.exe）

「基礎照査機能」は `S_SubstCheck.exe`（増分解析は `E_SubstCheck.exe`）で、直接基礎の照査値 `<DB1名>_Output_Chokukiso.csv`、算定値 `_Output_PIC.csv`、判定 `_直接基礎照査No1.csv` を結果の横に書く（2026-10-18、両 exe の文字列で確認）。

- NDU に直接基礎の照査のデータ（`ChokuKisoNum`・`CHOKU_KISO`・`CHOKU_KISO_Link`）がなければ、解析の後の「基礎照査機能を起動しますか？」の確認自体が出ず、この CSV はできない。
- 単一解析で「はい」と答えたときだけ動く。`scripts/run-analysis.ps1` と JRSNAPHeadless は「いいえ」と答えるので、この CSV を作らない。
- Aggre-SE が `_Output_Chokukiso.csv` を読む関係（ないときは DB1 から求め、値が一致しないことがある）はスキル `structural-aggrese` を参照。
