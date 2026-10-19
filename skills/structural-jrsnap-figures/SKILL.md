---
name: structural-jrsnap-figures
description: JRSNAP（Ver.5.2-L03／Ver.5.3-L01体験版2）の「データ確認図」（S_DataCheck.exe：非線形番号図・断面番号図・要素関連データ一覧表・断面詳細図・節点ばね分布図など）と「荷重図」（S_LoadPicture.exe：基本ケース CASE-n ごとの荷重図）を、.ndu（の組合せごとの .ndt）から画面操作なしで PDF にするときに使う。JRSNAPHeadless の runner の figures（--data-check・--load-diagram）、図の追加と作画条件の変更、どのケースをどの組合せの .ndt から描くか（組合せに使わないケースの荷重は0で書かれる）、PDF の確かめ方、帳票アプリを補助 exe の中で動かす共通の仕組み（ReportHost：ライセンス引数・アプリケーションドメイン・UI スレッドの操縦・ComponentOne の PDF 出力・TEMP の切り分け・終わり方）を扱う。図が白紙・順序違い・失敗する、補助が答えを返さない、ページ数やケースが合わない、5.3 で荷重図が落ちる、別の帳票アプリを同じ方法で動かすときにも使う。解析の実行には使わない（structural-jrsnap-input）。
---

# データ確認図・荷重図を PDF にする

JRSNAP の帳票アプリ（`S_DataCheck.exe`・`S_LoadPicture.exe`）には PDF の書出しがない。JRSNAPHeadless の runner の `figures` が、補助 exe（`JRSNAP.DataCheck.exe`・`JRSNAP.LoadPicture.exe`、x86）の中で帳票アプリを動かし、ComponentOne の PDF 出力でページを書く。

- runner の場所は環境変数 `STRUCTURAL_MCP_JRSNAP_RUNNER`（MCP のツールはまだない）。ソース（開発機のみ。structural-mcp の repo のルートから `JRSNAPHeadless/`、2026-10-19 時点では git 管理外の別 repo）の `README.md` を、使い方・成果物・失敗の種類の正とする。
- 帳票アプリは `.ndu` ではなく `.ndt` を読む。runner は `.ndu` から `.ndt` を `run` と同じ書出しで作業フォルダー（`%TEMP%\jrsnap-figures-<guid>`）に1回だけ作り、終了時に消す（`.ndt` は返さない）。書出しの仕組みはスキル `structural-jrsnap-input`。
- 開発機の 5.3 の逆コンパイルしたソース：`C:\RTRI_Program\JRSNAP(Ver5.3-L01体験版2)\S_DataCheck`・`...\S_LoadPicture`。5.2 のソースはない（IL で照合する。`references/load-picture.md`）。

## 使う：figures

```powershell
& $env:STRUCTURAL_MCP_JRSNAP_RUNNER figures `
  --input '<.ndu の絶対パス>' --output-dir '<空のフォルダー>' `
  --data-check 'nonlinear-numbers,section-numbers,element-table,section-detail,node-springs' `
  --load-diagram 1,2
```

- `--data-check` と `--load-diagram` の少なくとも一方を指定する。図と組合せは重複できず、指定した順を保つ。両方を1回で頼めば `.ndt` の書出しは1回で済む。
- データ確認図：図ごとに `<名前>.pdf`（kind `data-check`）を `--data-check` の順に返す。組合せは `--data-check-combination <n>`（既定 1）。番号図・断面・節点ばねは組合せで変わらないので、ふつうは組合せ1で足りる。
- 荷重図：組合せごとに `load-diagram-<組合せ>.pdf`（kind `load-diagram`）。その `.ndt` の全ケースを CASE の順に1ケース1ページ。`summary.loadDiagram[].pages` に `{page, case, title}`（`title` は `CASE-<番号> <タイトル>`）。
- **基本ケースは、それを使う組合せの `.ndt` のページから取る**。JRSNAP は組合せに使わない基本ケースの荷重を0にして `.ndt` を書くので、どのケースをどの組合せのページから取るかは呼び出し側が決める。荷重が0のページもそのまま返る。
- `--timeout-seconds` はコマンド全体の時間（既定 600）。補助は順に起動し、それぞれに残りの時間を渡す。所要時間の例：1回の起動は1組合せにつき 6〜7 秒、データ確認図5つと荷重図で `figures` 全体 26〜43 秒（2026-10-18、5.2-L03）。
- 版は runner の横の `jrsnap-headless.json` で決まる。別の版で試すときは `{"installDir": "C:\\RTRI_Program\\JRSNAP(Ver5.3-L01体験版2)"}` を書いた JSON を `--config <絶対パス>` で渡す。
- **荷重図は 5.2-L03 だけ**。5.3-L01体験版2 の `S_LoadPicture.exe` は単独では起動するが、補助の2つ目のドメインでは `frmMain` ができる前にアクセス違反になり、`LOAD_DIAGRAM_FAILED`（`AccessViolationException`）を返す。IL を比べても違いは見つからず、原因は調べていない。データ確認図は 5.3 でも動く。
- 画面は一瞬表示される。インストール先には何も書かないので mutex は取らない。ただし JRSNAP_Input.exe からの引渡しデータ（データ確認図は `nrflag.fil` か `*.wk0`、荷重図はインストール先の直下の `*.wk0`）が残っていると `BUSY`。
- 出力先は空か、ないフォルダーにする。

## データ確認図の名前と画面の対応

| `--data-check` の名前 | 作画条件設定（`frmSetPaper`）の作画帳票(軸線図) | 印刷実行（`frmPrint`）の対象図 |
|---|---|---|
| `nonlinear-numbers` | `_optJIKUSEN_3` 非線形番号図 | `_chkOutput_0` 軸線図 |
| `section-numbers` | `_optJIKUSEN_4` 断面番号図 | `_chkOutput_0` 軸線図 |
| `element-table` | `_optJIKUSEN_5` 要素関連データ一覧表 | `_chkOutput_0` 軸線図 |
| `section-detail` | （どれか1つは要る。`_optJIKUSEN_4`） | `_chkOutput_5` 断面詳細図 |
| `node-springs` | 同上 | `_chkOutput_2` 節点ばね分布図 |

- まだ名前のない図：`_optJIKUSEN_1` 節点番号図、`_2` 要素番号図、`_6` 着目点一覧表、`_chkOutput_1` 要素ばね分布図、`_3`/`_4` 地盤抵抗分布図、`_6` 要素諸元一覧、`_7` 地盤変位図。足すときは runner の `FiguresOptions.KnownFigures`（`JRSNAPHeadless/src/JRSNAP.Headless/RunOptions.cs`）と `JRSNAPHeadless/src/DataCheck/DataCheck.cs` の `Figure.Known` の両方に足す。その入力で S_DataCheck が無効にする図を選ぶと、印刷実行で「対象図名が選択されていません」が出て `UNKNOWN_DIALOG` になる（例：杭のない直接基礎では地盤抵抗分布図が無効）。
- 作画条件は全図で同じ（A4縦、各番号図に寸法線あり、着目点なし、節点番号と要素番号は別の帳票、縮尺は自動、出力断面番号は全断面）。変えるときは `DataCheck.cs` の `Steer` で設定するコントロール（`optA4`・`optV`・`chkSunpo`・`chkTyakumoku`・`chkFlg`・`chkPrintPage`・`Text1`）を直す。
- 1回の印刷の中の図の順序は S_DataCheck が決める（軸線図の帳票、要素ばね、節点ばね、地盤抵抗、断面詳細、要素諸元、地盤変位、着目点の順）。別の順にするには、図ごとに作画条件設定と印刷を1回ずつ行う（runner はそうしている）。
- 作図は部材の外形の枠を描かない（古い版の見本には外形の灰色の枠がある）。版の違いで、直さない。

## 荷重図の作画条件（runner が固定）

A4縦、縮尺は X・Y とも自動、1ケース1ページ、色はすべて黒、ページ番号（「p / N」）なし、同じ部材の要素荷重は段に分けて描く（`AutoRowFlg` 1）。それ以外の枠線・余白・文字の高さ・線幅・単位などは**プログラムの既定値**を使う。インストール先の `ini\LoadPicture.ini` は読まない（利用者が画面を使うたびに書き換わる、5.2-L03 と 5.3 で中身が違う、既定と違う色や値が入っている）。

- `AutoRowFlg`（`MSI_Set_LoadRow`）は同じ部材で重なる要素荷重を段に分ける。要素荷重の種別 4・5（`MEMBER LOAD` の種別。柱自重は 4）は、0 でも 1 でも段に分けない。1部材に要素荷重が1つの NDT では 0 と 1 で図はピクセル単位まで同じ。合成の NDT（部材1に要素荷重をもう1つ足したもの）では、0 は値が重なり、1 は2段に分かれた。種別4の既定の配置で節点付近の文字が重なることがあり、`AutoRowFlg` では直らない（JRSNAP の描画として受け入れる）。

## ヘッダーと PDF の確かめ方

- ヘッダーは両方の図で `【Ver5.2-L03】<印刷日>『<.ndt の名前>/<データ名>』` の右揃えに固定する（`Pilot.FixHeader`、`G_HeaderFlg` = 1,1,1,1,0,2）。インストール先の `ini\DataInputTool.ini [Header]` にはよらない。印刷日が入るので、同じ入力でも PDF のバイト列は日ごとに変わる。ハッシュで比べず、同じ日に出したものを PNG にして画素で比べる。
- PDF は `pypdfium2`（例：`uv run --no-project --with pypdfium2 --with pillow python -X utf8 …`）で開いて確かめる。荷重図の確かめ方（A4縦、ページ数＝ケース数、`CASE-<n>` の文字、ページ番号なし、評価版の文字なし、色の画素0、インストール先と TEMP の前後比較）は `references/load-picture.md`。

## 詳しく

- `references/report-host.md`：補助の中で帳票アプリを動かす共通の仕組み（ReportHost）と、別の帳票アプリを足すとき。
- `references/data-check.md`：S_DataCheck に固有の起動・読込・印刷と落とし穴。
- `references/load-picture.md`：S_LoadPicture に固有の手順、5.2 を IL で確かめる方法、確かめ方。

## 知見を足すとき

- JRSNAP の帳票アプリと JRSNAPHeadless の性質：このスキル（structural-mcp の `skills/structural-jrsnap-figures/`）を編集し、structural-mcp で commit する。JRSNAPHeadless のコードを変えたら、その repo の README.md も合わせる。
- WebPier がこの図を計算書に差し込む実装・決定・受入：WebPier の repo のスキル `webpier-jrsnap`。
- 案件の判断：その案件の repo。インストール先がコピー（MSI の利用者）のときは編集しない。
- コードで確かめたこと、実アプリで試したこと、推定を区別し、日付と JRSNAP の版を残す。
