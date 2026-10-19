# 帳票アプリを補助の中で動かす共通の仕組み（ReportHost）

2026-10-18 確認。ソースは開発機のみ（structural-mcp の repo のルートから `JRSNAPHeadless/src/ReportHost/ReportHost.cs`）。

JRSNAP の帳票アプリ（S_DataCheck・S_LoadPicture）は、どれも同じ `Protect.Protection` と ComponentOne（C1Report 4.5.2）を持ち、PDF の書出しの機能がない。そこで、2つの補助（`JRSNAP.DataCheck.exe`・`JRSNAP.LoadPicture.exe`、x86、版によらず1つ）が `ReportHost.cs` をリンクして、同じ形で動かす。

## ライセンス

`MDmain.Main` → `Protect.Protection` は、JRSNAP のトップ画面が渡すライセンス引数を `Interaction.Command()`、つまり**プロセスのコマンドライン**から読む。

- 末尾 11 文字が `Ver.<主>.<副>-L<FileBuildPart 2桁>` と一致しないと終了する。
- 値は S_ANALYSIS と同じで、5.2-L03 は `LicenseOptNo111111199999999999999Ver.5.2-L03`、5.3-L01体験版2 は `…Ver.5.3-L00`（帳票アプリの 5.3 の FileVersion は 5.3.0.0）。
- 引数がないと「直接起動は、できません」で終わる。
- ライセンスの確認に失敗すると、アプリ自身が `ProjectData.EndApp()` でプロセスを終える（終了コード 0、答えなし）。補助は `ProcessExit` の処理で失敗の答えを返す。
- ComponentOne・FarPoint の実行時ライセンスは、入口のアセンブリの埋込みライセンスで確かめる。

## 流れ（`Host.Serve` → `Pilot`）

1. runner が補助を、ライセンス引数だけで起動する。依頼の JSON は標準入力で渡す。
   - `CreateNoWindow` だとコンソールの入力が UTF-8 にならないので、`Console.OpenStandardInput()` を UTF-8 で読む（読まないと日本語のパスで「無効な JSON プリミティブ」）。
   - 環境変数 `TEMP`・`TMP` は、runner の作業フォルダーの下の、起動ごとに別のフォルダーに向ける（下の「一時領域」）。
2. 補助は、インストール先に JRSNAP_Input.exe からの引渡しデータがないことを確かめる（BUSY の判定はアプリごと）。
3. `AppDomain.CreateDomain`（`ApplicationBase` はインストール先、構成は `<アプリ>.exe.config`）の中で `ExecuteAssembly(<アプリ>.exe)` する。
   - これでアプリが入口のアセンブリになり、自身の保護処理と C1・FarPoint のライセンスがそのまま効く。評価版の表示は出ない。
   - 補助の中でアプリの型を直接作ると、C1 のライセンスが補助 exe で確かめられ、保護処理も通らない。この方法は採らない。
4. 同じドメインに `MarshalByRefObject` の操縦役（`Pilot` を継いだクラス）を作る。
   - 操縦役は、2つ目のドメインに `AssemblyResolve` を登録する。補助の exe はインストール先の下にないので、これがないと最初のドメインの `Reporter` の型を解決できない。
   - 主画面（`<GlobalType>.G_MainFrm`）が表示され、アプリごとの起動の条件（`IsStarted`）を満たすのを待ってから、`BeginInvoke` で UI スレッドに入り、`Work()` を行う。
5. モーダルの画面には、UI スレッドの `System.Windows.Forms.Timer` から答える（`Steer`）。このタイマーはモーダルのメッセージループでも動く。
   - 画面が現れてから2回分待って答える（読込の終わりを待つため）。
   - ボタンは `BeginInvoke` で押す。タイマーの中で押すと、開いたモーダル画面がタイマーの中で動いてしまう。
   - 画面の監視は `EnumWindows` とプロセス ID で行う。`EnumThreadWindows` は UI スレッドの画面しか見ないので、別のスレッドに出る表示（評価版の通知など）を見落とす。
   - `#32770` は、アプリが `Expected` で認めたもの（データ確認図ではプリンターの選択「印刷」）だけを取り消して進める。それ以外と知らない画面は記録して閉じ、失敗（`UNKNOWN_DIALOG`）にする。
   - 答えた窓は閉じるまで次のタイマーでも見えるので、窓ごとに1回だけ答える。2回目を未知の画面と数えると、「印刷: プリンター …」で失敗する（実際に起きた）。
6. 組み立てたページを、ComponentOne の PDF 出力（`<C1PrintDocument>.Export("<名前>.pdf")`）で書く。プリンターは使わない。「Microsoft Print to PDF」は、スプールが非同期でファイルが遅れて現れるので使わない。
7. 結果は `Reporter.Answer`（最初のドメイン）で stdout に1回だけ書いて flush する。その後、アプリを閉じずに `TerminateProcess` で即座に終える。
   - 閉じると設定の INI を書き、S_LoadPicture は `.lpd` の保存を問い、`EndApp` で終わる。
   - `Environment.Exit` でも、終了処理の中で S_DataCheck の画面が例外を出し、答えの後に終了コードが変わったことがある（1回）。
   - アクセス違反のようにプロセスごと落ちる例外も受け止めて、答えを返す。

## 一時領域

帳票アプリは `Interaction.Environ("TEMP") + "\RTRI\"` を一時領域にする（元に戻す操作用の `001〜010.tmp` を書き、閉じるときに消す）。C1 の PDF 出力は `%TEMP%\C1Pdf\` を作る。

- 補助の `TEMP`・`TMP` を作業フォルダーに向けるのは、利用者が画面で開いている JRSNAP の一時ファイルと干渉しないため。作業フォルダーと一緒に消える。
- mutex では、利用者の JRSNAP との干渉は防げない。
- `%TEMP%\Rtri\JRSNAP_Main\JRSNAP_Language.ini` がないと言語は 0（日本語）になる（開発機にはもともとない）。
- インストール先には書かないので、`figures` は mutex を取らない。

## 別の帳票アプリを足すとき

`Pilot` を継いで、次をアプリごとに書く。

- `AppName`
- `GlobalType`（`G_MainFrm`・`G_HeaderFlg` のある型。S_DataCheck は `MdlGlobal`、S_LoadPicture は `MdlGlobalProclaim`）
- `IsStarted`
- `Work`
- `Steer`
- `Expected`

あわせて、`Host.Serve` に失敗の種類の名前と BUSY の判定を渡す。読込の経路、画面のコントロール名、起動の条件、閉じるときに何を書くかは、アプリごとに逆コンパイルのソースで確かめ、5.2 は IL で照合する。S_LoadPicture を足したときの手順と違いは `references/load-picture.md`。
