# 入力画面の起動と NDU の保存

## 入力画面を起動する（2026-10-11、両版の `.bat` から起動したプロセスと応答中のウィンドウを確認）

選択した版に対応する次の **コマンドプロンプト（cmd.exe）用**の一行を使う（インストール先は開発機の既定）。

```bat
rem 既定: Ver.5.3
start "" "C:\RTRI_Program\JRSNAP(Ver5.3-L01体験版2)\JRSNAP_Input.exe" %LicenseOptNo111111199999999999999Ver.5.3-L00
rem Ver.5.2 を指定するとき
start "" "C:\RTRI_Program\JRSNAP(Ver5.2-L03)\JRSNAP_Input.exe" %LicenseOptNo111111199999999999999Ver.5.2-L03
```

- PowerShell からは選択した行を `cmd.exe /d /c 'start "" "...\JRSNAP_Input.exe" %LicenseOptNo...'` として実行する。`start` を PowerShell の別名として実行しない。
- 引数は先頭に `%` があり、末尾に `%` はない。各版の `.bat`（`C:\RTRI_Program\JRSNAP(Ver5.2-L03).bat` など）に記載された文字列をそのまま渡す。
- 起動前に選択したインストール先の `JRSNAP_Input.exe` プロセスを確認する。既に開いている場合、重複起動が必要な依頼でなければそのウィンドウを使う。二重起動は本体の `MDmain.PrevInstance` が拒否するので、版を切り替えるときは前の JRSNAP を閉じる。
- 起動後はプロセスの `ExecutablePath` が選択したインストール先を指し、`CommandLine` に対応する引数が含まれること、`MainWindowTitle` が空でなく `Responding` が `True` であることを確認する。これは起動確認で、アプリ内の計算やファイル操作の成功までは示さない。

## NDU を開いて保存する

1. 保存先の複製 `.ndu` を選ぶ。原本への保存を避けるため、開く前に絶対パスを確認する。`scripts/check-ndu-header.ps1 -Path <ファイルまたはフォルダー> -Version V52|V53` で形式番号の読込可否を調べる。これはヘッダー検査で、全入力項目の互換性保証ではない。
2. 対応する起動バッチで JRSNAP を起動する。`ファイル > 開く(&O)` で `.ndu` を選ぶ。読込に成功するとウィンドウのタイトルに開いたファイルのパスが入り、`mdlMenu.mnuFileOpen` は `WG_bytSystemDataFlg=3` にする。警告・読込失敗が出たファイルは保存しない。
3. `ファイル > 上書き保存(&S)` を使う。別名が必要なら `名前を付けて保存(&A)`。`mdlMenu.mnuFileSave` は `mdlDataFile.mdl_Wrt_NDUDataFile` で現在の `.ndu` を書く。保存の成功表示に加え、対象ファイルの更新時刻、先頭行の `Virsion=`、必要な入力項目を確認し、同じ版で再読込できるか確かめる。複数ファイルでは各ファイルの成功・失敗を個別に記録する。

`開く` と `上書き保存` は `.ndu` の操作である。`.ndt` は別の「解析用データ出力」で生成し（画面なしで行う方法は `references/ndt-export.md`）、`.OUT` などの計算結果は解析実行で更新する。`.ndu` を保存しただけで、複製済みの計算結果をその版の結果として扱わない。

## 画面操作できない環境での一括保存

`scripts/save-ndu.ps1` はインストール済みの各 `JRSNAP_Input.exe` を読み込み、画面の「開く」「上書き保存」が使う `mdl_Get_NDUDataFile` と `mdl_Wrt_NDUDataFile` を呼ぶ（補助の `scripts/roundtrip.cs` を同じフォルダーから使う）。JRSNAP の入力機能を初期化してから各 `.ndu` を一時領域で読込・保存し、保存済みファイルの再読込・再保存がバイト単位で安定することを検査する。`-Execute` を付けない実行は検査だけで対象を更新しない。画面や起動バッチを実際に操作した記録ではない。

```powershell
& '<このスキルのフォルダー>\scripts\save-ndu.ps1' -Path '<複製のフォルダー>' -Version V53
& '<このスキルのフォルダー>\scripts\save-ndu.ps1' -Path '<複製のフォルダー>' -Version V52 -ConvertS6
```

結果の `BeforeHeader`、`AfterHeader`、`ConvertedS6`、`BodyChangedLines`、`Written` を確認する。対象の複製フォルダーを指定し、検査が全件通った後で、同じコマンドに `-Execute` を付けて反映する。保存対象は `.ndu` だけで、解析用データ出力と再計算は別作業。

## この2版の形式制限

インストール済み本体の `mdlDataFile.VerCommonNo` を確認した結果、V5.2-L03 は読込形式番号が最大 `S.5`、V5.3-L01体験版2 は最大 `S.6`。超過時は `mdl_Get_NDUDataFile` が200を返して読込を拒否する。`Virsion=5.3.1.S.6` の `.ndu` は V5.2-L03 でそのまま開けない。ヘッダーだけを下げて実作業に使わない。

`-ConvertS6` は対象の原ファイルを直接書き換えず、一時コピーの先頭行だけ `S.6` から `S.5` にして V5.2 本体で読込・保存する。その結果を、同じ原ファイルを V5.3 本体で保存した結果と比較し、先頭行以外の全行が一致する場合だけ反映を許す。2026-10-11 の対象6件では全件一致し、V5.2・V5.3 の保存結果は各11件とも再保存時にバイト単位で一致した。直接基礎3件では両版で同じ1～2行が正規化される。この検証は今回の入力ファイルに限定され、計算結果や工学的な同等性までは確認しない。別の S.6 ファイルへ機械的に適用する前に差分を再検査する。

根拠：V5.3 本体の `JRSNAP_Input\frmMain.cs` のメニュー表示、`JRSNAP_Input\mdlMenu.cs` の `mnuFileOpen`／`mnuFileSave`／解析用データ出力、`JRSNAP_Input\mdlDataFile.cs` の読込・保存・形式番号判定。V5.2/V5.3 の形式上限と変換差分はインストール済み本体を一時ファイルで検証した。
