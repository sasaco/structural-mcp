# 解析用データ出力（.ndu→.ndt）を画面なしで行う仕組み

2026-10-18 確認。5.2-L03・5.3-L01体験版2 とも同じ。実際に使うときは JRSNAPHeadless の runner（`run --analyze false`、SKILL.md）を使う。

- 画面の経路：`frmMain.mnuDataOut_Click` → `mdlMenu.mdl_mnuGikkou_click(0)` → `frmKajyuuSelect` で組合せを選ぶ（`mdlMenu.M_CBCasePrint[1..20]`）→ 選んだ組合せ `i` ごとに `M_intCBCasePNo = i` として `mdlMenu.mnuFileWRT_NDTData`。この中で入力検査（MsgBox で中断）、変動ケースの問合せ（`G_intHendoSetInfo[1]==1` のときだけ）、最初の組合せでの保存ダイアログを経て、`mdlDATA_NDT.mdl_Wrt_NDTDataFile(ref path)`（0 が成功）を呼び、インストール先に `*.wk0`・`nrwork.dir` を書く。
- 名前：`<元の名前>(Case{i}_ρm{Format(ρm*10,"00")}_αf{Format(αf,"0")}_正向|_逆向[応の接尾辞]).ndt`。古い版の見本には `(Case-1_ρm=1.0_αf=1.0_荷重正方向)` の形もある。
- `mdl_Get_NDUDataFile` で読み、`M_intCBCasePNo` を設定して `mdl_Wrt_NDTDataFile` を直接呼ぶと、画面の `.ndt` とバイト単位で一致し（同じ版で作った見本6件）、インストール先には何も書かない。画面の検査は通らない。
- 版は入口のアセンブリ（`My.Application.Info.Version`）から取る。`.ndt` の1行目 `START 52|53` と、読める `.ndu` の形式（`VerCommonNo`）がこれで決まる。版のない補助 exe から呼ぶと `START    0` になる。そのため、補助 exe には JRSNAP と同じ AssemblyVersion（5.2.3.1・5.3.1.3）を付けて x86 で作る。`scripts/roundtrip.cs` も同じ理由で版を付けている。JRSNAPHeadless の書出しも版ごとに別の exe（`JRSNAP.NdtWriter52.exe`・`JRSNAP.NdtWriter53.exe`）。
- `G_intViewFlg` は `MDmain.Main` の値（JRSNAP では `G_intSNAP_FLG=1`）に、インストール先の `INI\DataInputTool.ini` の `[Option]` から [12] `CFT_Rect`（1→1、それ以外→2）、[22]=1、[24] `SekoJyoken` を重ねる。`mdl_Get_INIFile` は `Application.StartupPath`（補助 exe のフォルダー）の INI を読み、メイン画面の位置も設定するので、補助 exe からは呼ばずに値を自分で設定する。読込と `.ndt` の書出しが使うのは [1..7]・[16]・[23]・[24] だけ。古い見本との差は [23] が決める基礎の1項目に出る。JRSNAPHeadless は使った値を `summary.viewFlags` に返す。
- 組合せごとの `.ndt` では、その組合せが使わない基本ケース（`CASE-n`）の荷重が 0 になる。基本ケースごとの荷重を `.ndt` から読むとき（荷重図を含む）は、そのケースを使う組合せの `.ndt` を選ぶ。
