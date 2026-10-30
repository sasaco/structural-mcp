# SOIL-JR の .sdc を JRSNAP_Input に画面なしで連携させる（試しの道具）

杭のばね・有効抵抗土圧を JRSNAP_Input 自身の連携（`mdlRenkei`）で .ndu に入れさせ、自前で計算したばねと比べるための道具。2026-10-30 に JRSNAP_Input 5.2-L03 で、柱列骨組（杭3列、各列2本）の .ndu と SOIL-JR 5.2 の .sdc で動かした（実アプリで確認）。設計の成果物を作る道具ではない。

## 仕組み

`scripts/soil-link.cs` は `scripts/roundtrip.cs` と同じように `JRSNAP_Input.exe` をアセンブリとして読み込み（画面は起動しない）、次を呼ぶ。

1. `mdlDataFile.mdl_Get_NDUDataFile` で .ndu を読む。連携の設定は .ndu の `SRenkeiNum=1`・`SoilRenkeiFile1=<.sdc の絶対パス>`・`SoilRenkeiInfo1=` から読ませる。
2. 画面の「連携」の OK（`frmSoilRenkei.cmdOK_Click`）のうち `SetGlobal_SoilRenkei`（画面の値を読む部分）より後：`SOILData_Read` → `KuiCount` → `RenkeiDataCheck` → `SOILData_Read` → `SetOkuyuki`／`Calc_Bane2`（`G_optBane` が 0）→ `Calc_Bane3` → `mdlOptNo.変更前JointInfo` → `GET_JOINT_DATA` → `変更後JointInfo` → `SetTisou` → 杭の `G_sngKGInfo` に 1/β。
3. `mdl_Wrt_NDUDataFile` で書く。

5.2-L03 の `SOILData_Read` は引数2つ（ファイル名、IRCODE）。5.3 のソースの `DeFlg`・`ReadFlg` は 5.2 にない（2026-10-30、5.2 の型を反射で列挙して確認）。

`SoilRenkeiInfo1` の欄（`mdlDataFile.cs` の書出し）：検討方向 `G_KuiHoko`（1 橋軸、2 直角）、荷重方向 `G_KajyuHoko`（1 左→右、2 左←右）、適用位置 `G_TekiyoIchi`、連携する杭の左端・右端の部材番号 `G_STekiyoKUI`、フーチングの連携 `G_FootRenkei`、適用ケース4欄、ばねの扱い `G_optBane`（0：奥行き本数で割ってから掛ける）。

## 落とし穴

- **原点（`JointOrg`）は y＝0 の節点にする**。`GET_JOINT_DATA` は層の境界を「要素の深さ − (適用位置 − (杭部材の上端の y − 原点の y))」と比べ、画面の適用位置（`GetTekiyoIchi`＝杭先端の y − 杭長 ＋ 突出長）は原点が y＝0 にある前提で出る。原点が杭頭より上の別の節点だと「節点が層境界と一致しません。節点を追加しますか。」が出て、はいと答えると節点が足される。
- 途中で MsgBox が出て止まる。`soil-link.cs` は自分のプロセスの `#32770` の窓を見張って本文を標準出力に書き、答える：「要素を1Dで分割しますか」「非線形番号を自動設定しますか」「任意番号を全てクリアしますか」は**いいえ**（はいだと杭の節点が消えて 1D で切り直され、非線形番号も振り直される）、「連携しますか」ははい、「節点を追加しますか」はキャンセル、ほかは OK。
- 2026-10-30 の試しでは、3列のうち2列目・3列目だけにばねが入り、1列目には入らなかった（`SuppotRow` 20）。原因は調べていない（画面の杭列の選択 `cmbKuiRetu` を通らないためと推定）。比べるときは入った列だけで比べる。
- 読み込んだ .ndu は JRSNAP_Input の形で書き直される（行の並び・桁）。比べるのは `SuppotInfo` と `JibanShogenInfo` を節点の座標で引いて行う。

## 使い方

```powershell
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /platform:x86 /reference:System.Windows.Forms.dll /out:soil-link.exe soil-link.cs DialogAutomation.cs
# soil-link.exe.config に loadFromRemoteSources を有効にする設定を置く（save-ndu.ps1 と同じ内容）。無いと「ネットワーク上の場所から読み込もうとしました」で止まる
.\soil-link.exe '<インストール先>\JRSNAP_Input.exe' '<連携の行を足した .ndu>' '<出力 .ndu>'
```

ヘルパーの AssemblyVersion は 5.2.3.1（5.2-L03 用）。解析は起動せず、インストール先にも書かない（.ndu の読み書きと計算だけ）。同じ PC で別の JRSNAP が動いていてもぶつからないが、利用者が止めてほしいと言ったら待つ。
