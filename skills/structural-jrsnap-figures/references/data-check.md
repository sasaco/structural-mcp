# S_DataCheck に固有のこと

2026-10-18 確認。対象はインストール済みの `S_DataCheck.exe`（5.2-L03 は AssemblyVersion 5.2.3.0、5.3-L01体験版2 は 5.3.1.0）。開発機の 5.3 の逆コンパイルしたソース（`C:\RTRI_Program\JRSNAP(Ver5.3-L01体験版2)\S_DataCheck`）：

- `mdlMain.cs`：読込と印刷
- `frmSetPaper.cs`：作画条件
- `frmPrint.cs`：対象図
- `mdlMakePicture.cs`：作画

補助のソースは開発機のみ（structural-mcp の repo のルートから `JRSNAPHeadless/src/DataCheck/DataCheck.cs`）。

- **起動の条件：** 非公開の `SystemFlg` が 1 になる（`frmMain_Activated` が引渡しデータを確かめ終えた）のを待つ。
- **読込：** JRSNAP_Input.exe から引き渡されたデータと同じ経路で行う。`MdlWork.G_strFileName = <.ndt>`、`MdlGlobal.WorkFlg = 1` として `mdlMain.mdl_MENU_FILE_DATA()` を呼ぶ（終われば `WorkFlg = 0`）。
  - `mdl_GET_DATA` だけを呼ぶと、配列の準備（`Mdl_Get_TotalNum`・`SetRedimArray`）がなく `NullReferenceException` になる。
  - この経路は、最後に作画条件設定（`frmSetPaper`）をモーダルで開く。
- **ヘッダーの固定：** 読込の前に行う。`GetIniFileHeader` は `frmMain_Load` で読まれ、`SystemFlg` はその後に立つので、この順で上書きできる（5.2 の IL でも同じ）。
- **印刷：** `mdlMain.mdl_MENU_FILE_PRINT_Click(1)` は、`frmPrint` で選んだ図を `frmMain.C1PrintDocument2` に組み立て、`PrintDialog` を出す。取り消しても `C1PrintDocument2.Generate()` は済んでいるので、それを書き出す。RTF 出力（`pFlg=2`）はあるが、PDF も「Docu-SE」連携もない。
- **順序と図の数：** 1回の印刷の中の順序は S_DataCheck が決める（SKILL.md）。図ごとに作画条件設定と印刷を1回ずつ行えば、任意の順にできる。

## 落とし穴

- 5.2-L03 は、作画条件設定の「出力断面番号指定」（`Text1`）を空のまま開く。そのままでは `Mdl_YousoSitei` が0件になって、断面詳細図が白紙の1ページになる。`1-<MdlWork.G_intSectNum>` を入れる。5.3 は読込で `1-<断面数>` を入れる。
- S_DataCheck は起動時に、インストール先の `nrflag.fil`（`frmMain_Activated`）と `*.wk0`（`frmMain_Shown`、サブフォルダーも探す）を開こうとする。JRSNAP_Input.exe からの引渡しが残っていれば別のデータを読むので、`BUSY` で止める。
- `Application.StartupPath` は補助 exe のフォルダーになる。
  - `Mdl_NM_Get_IniData` は `SekoJyoken` をそこの `INI\DataInputTool.ini` から読もうとするので、既定値（0）になる。
  - ほかの INI はインストール先（`My.Application.Info.DirectoryPath`）から読む。
- S_DataCheck は `.ndt` の横に `.nd3` を書く（runner では作業フォルダーごと消える）。
