# S_LoadPicture に固有のこと

2026-10-18 確認。対象は `S_LoadPicture.exe` 5.2-L03（FileVersion・AssemblyVersion 5.2.3.0）。開発機の 5.3 の逆コンパイルのソース（`C:\RTRI_Program\JRSNAP(Ver5.3-L01体験版2)\S_LoadPicture`）：

- `frmMain.cs`：起動・新規作成・印刷・終了
- `mdlDataFile.cs`：INI と NDT の読込
- `mdlSystemInfo.cs`：用紙・ケース分け
- `frmSetPaper.cs`：軸線レイアウト
- `frmLoadLayout.cs`：荷重レイアウト
- `frmPreView.cs`：印刷のプレビュー
- `mdlViewControl.cs`・`mdlDrawLoad.cs`：作画

5.2 のソースはない。5.3 のソースで書いた手順は 5.2 でそのまま動いた。関係するメソッドの IL の違いは次の3点だけ：`frmMain_Load` の `MDF_DataInit`、`frmLoadLayout.cmdOK_Click` の `MDC_MenuInit`、`[Header] Trial`。

**S_LoadPicture は `.ndt`（と `.rdt`）しか読まない。** NDT の `LOAD` の `CASE-n`（基本ケース）ごとに1ページを描く。`.ndt` は組合せごとのファイルで、組合せに使わない基本ケースの荷重は0で書かれている。

補助のソースは開発機のみ（structural-mcp の repo のルートから `JRSNAPHeadless/src/LoadPicture/LoadPicture.cs` の `LoadPicturePilot`）。起動・ドメイン・操縦・書出し・終わり方の共通部分は `references/report-host.md`。

## 起動の条件

`MDmain.Main` は `new frmMain().ShowDialog()` で、S_DataCheck の `SystemFlg` に当たるものはない（宣言だけで代入されない）。`MdlGlobalProclaim.G_MainFrm` が Visible でハンドルが作られたら `BeginInvoke` する。`frmMain_Shown`（`*.wk0` を探す）は先に済んでいる。

## 1. 作画条件を INI から切り離す（UI スレッドの最初）

- `frmMain` のコンストラクター（`Form_Initialize_Renamed` → `MDF_Get_INIFile`）は、インストール先の INI を読む。読むだけで害はない。
- その後で、`mdlGlobalWorkProclaim.WG_strIniFileName` を作業フォルダーの**存在しない**ファイルに向けて、`mdlDataFile.MDF_Get_INIFile()` を呼び直す。全キーがプログラムの既定値になり、色は Color1〜26 がすべて 0（黒）、`AutoRowFlg` 0 になる。
- 念のため `GT_BOther.bytColor` を 0 で消し、`WG_bytAutoRowFlg` を依頼の値にする。
- 構造体のフィールドは値型。`FieldInfo.GetValue` は箱詰めの写しを返すが、中の配列（`bytColor`）は共有の参照なので、要素を直接変えられる。
- 一時の INI は最後まで作られない。作られていれば、閉じる経路を通った証拠になる。
- `MDF_Get_INIFile` は主画面の位置も動かし、インストール先の `nrwork.dir`（フォルダーの上書き）と `C:\nwl\Project\Project.ini` を読む。どれも読むだけ。
- ヘッダーを固定する（`FixHeader`）。`frmMain_Load` の `GetIniFileHeader`（`ini\DataInputTool.ini [Header]`）が先に済んでいるので、この後に上書きする。
- インストール先の `ini\LoadPicture.ini` には、色（`Color7=4` など）や、`Flame 15`・`TextHeight2 7` のように既定と違う値が入っていた（開発機）。5.2-L03 と 5.3 では `AutoCaseFlg`、`LineWidth4/5` などが違う。

## 2. NDT を読む（「新規作成」の手順を、インストール先への書込みを除いて直接呼ぶ）

`frmMain.mnuFileNew_Click` は、インストール先の `nrwork.dir` と INI の `NDTInitFolder` を書くので、メニューは使わない。

1. `WG_strNDTFileName = <.ndt>`、`SakugaLoadFlg = 0`、`WB_Flg = 0` にする。
2. `mdlSystemCommon.Mdl_Get_TotalNum(1, ndt)` → `SetRedimArray(1)` → `mdlDataFile.MDF_DataFormat2()` を呼ぶ。
3. `MDF_Get_NDTData(ndt)` を呼ぶ。0 以外は `NDT_READ_FAILED`。
4. `mdlSystemInfo.MSI_Chk_ErrorData()` を呼ぶ。0 より大きければ `NDT_REJECTED`。
   - 画面では「要素荷重が不正です！」の MsgBox が出て、何も読まない。
   - 要素荷重の2つの値（列 36〜55）がともに0の行が1つでもあると、こうなる。JRSNAP が組合せに使わないケースで0にするのが節点荷重だけなら起きない。
5. `WB_Flg == 1`（土圧の WB ブロック）なら、`frmSakugaOption` を開いて「一般荷重」（`_Option1_0`）→ `Command1` で答える。この経路は実物では確かめていない。
6. `G_bytObjectViewFlg[11] = 1`（要素番号を隠す）にする。
7. **`WG_bytAutoCaseFlg = 0` にする。**
   - `MDF_Get_NDTData` はケースが1以下のときこれを 1 にし、次の `MSI_Chk_NDTData` がそれを使って、種別ごと（固定荷重・死荷重地震・活荷重地震）の最大3ページに分けてしまう。
   - 0 にするのは、この2つの呼出しの**間**でなければならない。読込の後では遅い。
   - INI の `AutoCaseFlg` は、`.ndt` では効かない。
8. `MSI_Chk_NDTData()` を呼ぶ。A4 にし、モデルが横長なら横向きにし、縮尺を自動にする。
9. `WG_bytSystemDataFlg = 0` → `MDF_WorkDispInit()` を呼ぶ。
10. `frmSetPaper`（軸線レイアウト）をモーダルで開く。答え方は次の「画面の答え方」。
11. `WG_bytSystemDataFlg == 2` を確かめる。
12. `mdlDispControl.Set_State_Open` → `mdlUndoRedo.MUR_SetUndo` → `mdlZoom.MZ_Zoom_AllView` を呼ぶ。

## 画面の答え方（`Steer`）

- **`frmSetPaper`（軸線レイアウト）：**
  - 表示されて2回分待ち、さらに `blnFormLoadFlg` が true になり、**プレビューの生成が終わってから**答える（画面の `C1PrintDocument` 型のプロパティのどれも `IsGenerating` でない）。
  - 横長のモデル（WebRamen の橋軸方向ラーメン、幅 49 m）は、`MSI_Chk_NDTData` が横向きにし、画面を開いたときのプレビューの生成に時間がかかる。その途中で `optV` を選ぶと `SetPaperPreview` が「ドキュメントの生成が既に開始されています。」の例外を出す。縦長の橋脚・直角方向の骨組では起きなかった（2026-10-27、5.2-L03）。
  - `optV` を選ぶとプレビューをもう一度作るので、「次へ」はそれが終わった後のタイマーで押す。`WG_bytSystemDataFlg` が 0 のあいだ（荷重レイアウトへ進むまで）は、1秒ごとに押し直す。1 になってから押すと、作画して画面を閉じる別の経路に入るので押さない。
  - `optA4`・`optV` を選び、`cboX`・`cboY` の `SelectedIndex = 0`（自動）にして、`cmdOK`（「次へ」）を押す。
  - `optV` を選ぶと `SetPaperPreview` が縦で縮尺を計算し直す。
  - `cmdOK_Click` の中で `frmLoadLayout` が開く。
  - `frmSetPaper` は、全ケースのタイトルの位置（`MSI_Get_InitPosition`）も決めるので、飛ばさない。
- **`frmLoadLayout`（荷重レイアウト）：** プレビュー（`C1PrintDocument2`）の生成が終わってから `cmdOK` を押す。`WG_bytSystemDataFlg = 2` になる。FarPoint の表を使うが、評価版の表示は出ない。
- **`frmPreView`：** 下の「3. ページを組む」。
- **それ以外の画面と `#32770`：** 失敗にする。「データエラー」「読込みエラー」（100〜104）「入力値エラー」が出るはずのものは、手順の中で検査して先に止める。

## 3. ページを組む（画面の印刷と同じ経路）

1. `G_bytObjectViewFlg[3] = 1`（ページ番号を隠す）は、`mnuFilePrint_Click` の直前に設定する。コンストラクターの `MDF_DataFormat` が0に戻すため。
2. `frmMain.mnuFilePrint_Click` は、`frmPreView` をモーダルで開く。`frmPreView_Load` の `MakePreView` が、1〜`G_intCaseNum` の全ページを `C1PrintDocument_prev` に組んで `Generate()` する。ページの間は `RenderText{BreakBefore = Page}`、各ページは `MVC_ViewControl_ALL(doc, 2, 0)` で描く。印刷のダイアログは、ツールバーのボタンを押さない限り出ない。
3. タイマーで `frmPreView` を見つけ、`IsGenerating` でなくなったら `Export` し、`BeginInvoke(Close)` で閉じる。`frmPreView` には Closing・Closed の処理がない（5.2 のメタデータと 5.3 のソースで確認）。
4. ページ数が `G_intCaseNum` と違えば `PAGE_MISMATCH`。
5. ページとケースの対応は `MdlGlobalProclaim.G_strCaseTitle[1..G_intCaseNum]` から取る。タイトルは `"CASE-" + 番号 + " " + Mid(CASE 行, 40, 80)` の形。
6. `frmMain.C1PrintDocument_main` は、画面の今のページしか持たないので使わない。

## 4. 終わり方

結果を書いてから、`frmMain` を閉じずにプロセスを終える（ReportHost）。`frmMain` を閉じると、次の処理が走る。

- `FormClosing`：`WG_bytSystemDataFlg == 2` なら、`<WG_strSystemDataFolder>\<ndt名>.lpd` を黙って書くか、「データが更新されています。保存しますか？」を出す。
- `FormClosed`：`MDF_Wrt_INIFile()` で INI を全部書き出す → `%TEMP%\RTRI\###.tmp` を消す → `DataInputTool.ini [Option] Docu-SE = 1` なら `.w09` を書く → `ProjectData.EndApp()`。このため `ExecuteAssembly` は戻らない。

**BUSY：** S_LoadPicture は起動時に、インストール先の**直下**の `*.wk0` を開く（`frmMain_Shown`。`nrflag.fil` は見ない）。あれば `BUSY`。

## 確かめ方

- **PDF：** `pypdfium2` で開いて、次を確かめる。
  - 全ページが 595.3×841.9pt（A4縦）であること
  - ページ数がケース数と同じこと
  - 各ページの文字に `CASE-<n> <タイトル>` があること
  - 数字の「/」が日付だけであること（ページ番号がない）
  - ComponentOne・Evaluation・評価・FarPoint・Trial の文字がないこと
  - 組合せに使うケースのページに、そのケースの荷重の値があること（使わない組合せのページでは0になる）
- **色：** 150dpi の PNG にして、R・G・B が揃っていない画素を数え、0 であることを確かめる。
- **前後比較：** インストール先（開発機の 5.2-L03 で 333 項目）、利用者の `%TEMP%\RTRI`・`%TEMP%\C1Pdf` の、パス・サイズ・更新日時・SHA256 を、実行の前後で比べる。
  - 実行中に `JRSNAP_Input`・`S_ANALYSIS`・`S_DataCheck`・`S_LoadPicture` などのプロセスが動いていれば、その回は無効にする（ほかのセッションの runner でも濁る）。
  - 補助の作業用の TEMP に `RTRI\001.tmp` が残ることは、閉じずに終えた証拠になる。
- **出力の同一性：** 補助を作り直したときは、同じ日に出した前の PDF と、全ページの画素を比べる。

## 5.2 を IL で確かめる

5.2 のソースはないので、5.3 のソースで書いた手順に使うメンバーは、5.2 の exe のメタデータで実在とシグネチャを確かめる。メソッドの中身は `MethodBody.GetILAsByteArray()` と `Module.ResolveMember`・`ResolveString` で比べる。読み込みは x86 のプロセスから `Assembly.LoadFile`（リフレクションだけ）で行う。デコンパイラーはなくても、IL のダンプで足りた。
