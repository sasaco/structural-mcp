---
name: structural-jrsnap-input
description: JRSNAP（鉄道総研の静的非線形解析。Ver.5.2-L03／Ver.5.3-L01体験版2）の入力画面 JRSNAP_Input.exe を起動・確認する、既存の .ndu を開いて版別に保存する（版の形式番号 S.5／S.6 の制限、V5.2 への変換の検査）、既存の .ndt を入力画面なしで S_ANALYSIS.exe に単一・複数解析させる、JRSNAPHeadless の runner（run）で .ndu から .ndt の書出しと解析までを画面なしで行うときに使う。解析用データ出力（.ndu→.ndt）の内部の手順と名前の規則、解析エンジンの確認画面と自動応答、結果ファイル（暗号化 zip で毎回バイトが変わる）、インストール先の共用ファイルと同時実行の禁止、基礎照査機能（S_SubstCheck.exe）が書く CSV、耐震設計総括表（SSheet.exe）の xlsx も扱う。.ndu の項目の直接編集は structural-jrsnap-ndu、データ確認図・荷重図の PDF は structural-jrsnap-figures、SOIL-JR は structural-jrsnap-soil。
---

# JRSNAP の入力を開く・保存する・解析する

対象は JRSNAP Ver.5.3-L01体験版2（既定）と Ver.5.2-L03 の2版だけ。開発機の既定のインストール先は `C:\RTRI_Program\JRSNAP(Ver5.3-L01体験版2)` と `C:\RTRI_Program\JRSNAP(Ver5.2-L03)`。利用者の環境では別の場所のことがあるので、インストール先は利用者か runner の設定（下の `jrsnap-headless.json`）で確かめ、スキルの置き場所から推定しない。JRSNAP 本体はライセンス品で、structural-mcp は同梱しない。

- 画面の起動と NDU の保存（開く・上書き保存、版の形式番号）：`references/open-save.md`
- 解析用データ出力（.ndu→.ndt）を画面なしで行う仕組み：`references/ndt-export.md`
- 解析エンジンの画面・結果ファイル・基礎照査機能：`references/engine.md`
- 耐震設計総括表（SSheet.exe。Output-JR）の入出力と、損傷レベルが小数点以下7桁であること、Docu-SE との突き合わせ：`references/summary-sheet.md`
- 見本データ（開発機のみ。structural-mcp の repo のルートから）：`Batch/tests/JRSNAP_Ver5.3-L01体験版2/`・`Batch/tests/JRSNAP_Ver5.2-L03/`。原本を直接開いて保存しない（複製を使う）。

## .ndu から解析まで画面なしで行う（JRSNAPHeadless の runner。先にこちら）

`.ndt` がなく `.ndu` だけがあるとき、または結果を protocol v1 の envelope で受け取りたいときは JRSNAPHeadless の runner（`JRSNAP.Headless.exe`）を使う。MCP のツールはまだない。runner の場所は環境変数 `STRUCTURAL_MCP_JRSNAP_RUNNER`。ソース（開発機のみ。structural-mcp の repo のルートから `JRSNAPHeadless/`、2026-10-19 時点では git 管理外の別 repo でリモートなし）の `README.md` を、使い方・失敗の種類・成果物の正とする。

```text
run --input <.ndu または .ndt の絶対パス> --output-dir <空の、またはないフォルダー>
    [--analyze true|false] [--timeout-seconds <既定 1800>] [--config <設定ファイルの絶対パス>]
```

- `.ndt` は「解析用データ出力」と同じ処理（`mdlDATA_NDT.mdl_Wrt_NDTDataFile`）を直接呼んで作る。全組合せを画面と同じ名前で出し、画面が書出しの前に MsgBox で行う入力検査は通らない（`references/ndt-export.md`）。
- `--analyze false` は `.ndt` を作るだけで、インストール先に何も書かない。画面で出力した `.ndt` との突き合わせに使う。
- `--input` に `.ndt` を渡すと書出しをせず、その `.ndt` を複写して解析する（画面と `.ndu` からは指定できない設定、例：DA ブロック1行目の列70 の収斂方法フラグを書いた `.ndt` のため）。1行目の `START 52|53` がインストール先の版と違えば `UNSUPPORTED_INPUT`（JRSNAPHeadless 9e3c8fe、README）。
- 解析の自動応答は下の `run-analysis.ps1` と同じ。違いは、タイムアウトや未知の確認（標準のメッセージボックス、または基礎照査以外の「解析機能」の窓が約3秒続く）のとき、`S_ANALYSIS.exe` とその子プロセスを終了させ、`renzoku.flg`・`nrwork.dir` を元のバイト列に戻すこと。`run-analysis.ps1` はタイムアウト時に残す。
- インストール先は runner の横の `jrsnap-headless.json`（`{"installDir": ...}`）で決め、版は `JRSNAP_Input.exe` の AssemblyVersion（5.2.3.1・5.3.1.3）で判定する。別の版で試すときは、その形の JSON を `--config` で渡す（設定ファイルそのものは書き換えない）。同じインストール先の解析は `Global\structural-mcp-jrsnap` の mutex と起動中のプロセスの検査で直列にする。
- `engineeringStatus` は成功なら `not_checked`（解析は応答を求めるだけで、耐震性能は判定しない）。`.LOG` の警告は `LOG_WARNING`、`.EMG` の各行は `ENGINE_MESSAGE` で、失敗にはしない。
- データ確認図・荷重図の PDF（`figures`）はスキル `structural-jrsnap-figures`。

## 入力画面を起動せずに既存の .ndt を解析する

`scripts/run-analysis.ps1` は `JRSNAP_Input.exe` を起動せずに `S_ANALYSIS.exe` の単一または複数解析経路を使う。`-InstallDir` を省略すると Ver.5.3（スクリプトの既定は開発機の既定のインストール先）、Ver.5.2 は `-InstallDir '<5.2-L03 のインストール先>'`。スクリプトは版に対応するライセンス引数を渡す。最初は `-NdtPath <ファイル>` だけで事前確認し、実行するときに `-Execute` を加える。複数解析は同じフォルダーの異なる `.NDT` を2件以上指定する。件数に応じた `work.wk3` と `renzoku.flg` をインストール先に用意して解析エンジンを起動する。共用の作業ファイルを使うため、同じインストール先の関連アプリが起動中なら実行を拒否する。

```powershell
$skill = '<このスキルのフォルダー>'
& "$skill\scripts\run-analysis.ps1" -NdtPath '<複製した .ndt の絶対パス>'
& "$skill\scripts\run-analysis.ps1" -NdtPath '<.ndt>' -Execute -TimeoutSeconds 300
& "$skill\scripts\run-analysis.ps1" -NdtPath '<.ndt>' -InstallDir 'C:\RTRI_Program\JRSNAP(Ver5.2-L03)' -Execute -TimeoutSeconds 300
& "$skill\scripts\run-analysis.ps1" -NdtPath 'C:\path\to\case1.ndt', 'C:\path\to\case2.ndt' -Execute -TimeoutSeconds 300
```

- `-Execute` はエンジンの既知の確認も自動で進める。単一解析では、`Nrail.exe` のコンソールに「エンターキーを押して画面を閉じて下さい」が出たときだけ Enter を送り、「耐力と変形性能の自動算定」では画面の初期チェック状態のまま「実行」を押し、「基礎照査機能を起動しますか？」には「いいえ」を選ぶ。**基礎照査機能まで必要な依頼にはこのスクリプトをそのまま使わない**。
- 複数解析の実機試験では途中の2種類の確認は出ず、最後の「解析が全て終了しました。」だけを自動で閉じた。エラーがあるという完了通知ならスクリプトは失敗として報告する。
- `S_ANALYSIS.exe` の画面は表示されるので、これは非対話の自動操作であり、エンジン自体の headless モードではない。未知の確認画面では自動選択せず、タイムアウト時は起動中のエンジンと制御ファイルを残す。
- `S_ANALYSIS.exe` のライセンス処理は引数の先頭 12 文字が `LicenseOptNo` であることを確認する。スクリプトは選択した版の `start` コマンドの `%` を含めず、同じライセンス文字列をエンジンへ渡す。対応するインストール先は上の2件だけで、それ以外は実行前に拒否する。
- 根拠：`JRSNAP_Input/frmMain.cs` の解析実行は `mdlMenu.RunANALYSIS` に進み、`JRSNAP_Input/mdlMenu.cs` は単一を `intFlg=1`、複数を `intFlg=2` として制御ファイルを作り `S_ANALYSIS.exe` を起動する。インストール済み `S_ANALYSIS.exe` の入口は `.wk3` があればファイルを読んで解析に進む。エンジンの `mdlRenkei.RunANALYSIS2` は自動算定画面と基礎照査の起動確認を `NdataEx == 1` の場合に限定している。`.NDT` の生成は入力画面側の別処理なので、このスクリプトには含まれない。
- 2026-10-11 に Ver.5.3 の Case1 単一と Case1・Case2 複数で全確認の自動処理、終了コード 0、各 `.OUT` と `.LOG` の更新、`work.wk3` の削除と `renzoku.flg` の復元を確認した（実アプリ）。計算ログには高軸方向圧縮力を受ける要素の警告があるため、結果の技術的な妥当性はログと成果物で別途判断する。

## 知見を足すとき

- JRSNAP そのものの性質（画面、形式、解析エンジン、JRSNAPHeadless の挙動）：このスキル（structural-mcp の `skills/structural-jrsnap-input/`）を編集し、structural-mcp で commit する。開発機ではインストール先がこのフォルダーへのジャンクションなので、そのまま全案件に効く。
- WebPier が JRSNAP を使う実装・決定・受入：WebPier の repo のスキル `webpier-jrsnap`。
- 案件の判断・見本の読み替え：その案件の repo。
- インストール先がコピー（MSI の利用者）のときは編集しない。案件側に書いて開発者に伝える。
- コードで確かめたこと、実アプリで試したこと、推定を区別し、日付と JRSNAP の版を残す。
