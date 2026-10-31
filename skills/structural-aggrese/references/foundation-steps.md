# 直接基礎のステップ表（`--foundation-steps`）と DB1 の覗き方

## 使える版

- runner の `run` の省略可の引数 `--foundation-steps true|false`（既定 false。`inspect` では拒否）。Batch の commit 9c70f54（2026-10-19、Batch のブランチ sasa/dev）で入った。structural-mcp が 2026-10-19 に固定している Batch（47d1654）の runner にはまだない。
- MCP の `aggrese_calculate` はこの引数を公開していない（`src/server.ts`、2026-10-19）。使うときは 9c70f54 以降で build した runner を直接呼ぶ。

## 出力

- XML の `Foundation/基礎照査/clsFoundation/FoundationType` が 1（直接基礎）のとき `foundation-steps.csv`（kind `foundation-steps-csv`、`text/csv; charset=utf-8`、UTF-8・CRLF・BOM なし、見出し行付き）が返る。杭基礎（0）では何も返らず、失敗にもならない。
- 列は `case_index`（0 始まり）, `case_name`（DB1 の名前）, `node`, `step`, `V`, `H`, `M`, `qvd`, `qd`, `Rvd`, `Mmd`, `plasticity`。
  - 節点は `SNAPClass.GetChokukisoJoint()`（`OutputInfo.OutChokukiso` の `JoNo ≠ 0`）。
  - `V`・`H`・`M` は `CSNAPDBEx.ChokukisoVd/Hd/Md(istep, node, 2)`（支点ばね反力 `JibanHanryoku` の合計。VB の `Single` で足すので 16825.970703125 のような値。`H` は符号付き（例では線路方向が負）、`M` は絶対値）。
  - `qvd`〜`plasticity`（`Sosei`、比）は `ChokuItem(min(istep+1, Count−1))` の JRSNAP の値のまま。
  - 数値は `"R"` 形式（丸めない）。

## step の番号（本物の DB1 で確認、2026-10-19）

- `StepCtrl(istep)` ↔ `ChokuItem(istep+1)` ↔ JRSNAP の出力リストの増分ステップ番号 `istep+1`。CSV の `step` はこの JRSNAP の番号。
- `StepCtrl(0)`・`ChokuItem(0)`・`ChokuItem(1)` は初期状態（H=0）。
- JRSNAP の出力リストの「増分ステップ＝31、荷重増分ステップ数 360」は `StepCtrl(30)`（`LoStepNo=360`）＝ CSV の step 31 と一致した。
- `IChokukiso.RvdStep`（JRSNAP 自身の Rvd到達ステップ）は、CSV で `V ≧ Rvd` になる最初の `step` と一致する（3 Case で確認）。
- Rvd 到達後は JRSNAP が `ChokuItem` を到達ステップの値に固定するので、`qvd`〜`plasticity` は変わらず、`V`・`H`・`M` だけ進む。

## DB1 を画面なしで覗く（SNAPDBLib を PowerShell の反射で読む）

```powershell
[Reflection.Assembly]::LoadFrom('<runner のフォルダー>\SNAPDBLib.dll')
$db = New-Object SNAPDBLib.CSNAPDB
$db.DataRead($db1)          # 0 なら成功
$db.InputInfo.KihonInfo     # KisoType・LastStep・JNo
$db.OutputInfo.StepCtrl[$i].LoStepNo
$db.OutputInfo.StepCtrl[$i].JointItem[$n].JibanHanryoku
$db.OutputInfo.OutChokukiso[$k].RvdStep
$db.OutputInfo.OutChokukiso[$k].ChokuItem[$j]
```

- `.OUT` はパスワード付き zip で読めない。
- repo の `Batch/Aggre-SE/SNAPDBLib.dll` は、`LoadFrom` が 0x80131515 で失敗した（ダウンロードしたファイルとしてブロックされている）。`[Reflection.Assembly]::UnsafeLoadFrom(...)` なら読める（2026-10-22、32 ビットの Windows PowerShell 5.1 で確認）。
- `IKihonInfo`・`IOutSokatuBreak` などは `CSNAPDB` の入れ子の型で、値はプロパティではなく**フィールド**（一覧は `GetFields()`）。
- `OutputInfo.StepCtrl[$i].MemberItem[$e].M_Kaiseki_S` の M1〜M4 は C・Yb・M・Y 点の M で、θ は持たない。M-θ 要素の応答の部材角は、要素両端の節点の `JointItem[$n].DeltaT` の差で求まり、Aggre-SE の θd と一致した。支点ばねの節点の鉛直変位は `JointItem[$n].DeltaY` で読める（2026-10-30、JRSNAP 5.2-L03 の本物の DB1、WebRamen R6）。
- Windows PowerShell 5.1 は BOM なしのスクリプトを ANSI で読むので、日本語のパスはスクリプトに書かず引数で渡す。

## Batch 側のテスト

開発機のみ。structural-mcp の repo のルートから `Batch/tests/Aggre-SE.Test/HeadlessRunnerTests.cs`（9c70f54 以降）：

- PHC（杭基礎）の見本で CSV が返らないこと。
- 直接基礎（既定は Batch の repo のルートの隣の `WebPier/post/線路方向.xml`、環境変数 `AGGRE_SE_TEST_DIRECT_FOUNDATION_XML` で差替え、なければ skip）で、各行を `CSNAPDBEx` から読み直して照合する。
- `summary.outputs` は result.json を含まず、帳票を作らない呼び出しでは `cases[].aggregated` が false になる（既存の仕様）。

## SNAPDBLib を反射で直接呼んで、条件を総当たりする

Batch の `CSNAPDBEx`（`Batch.exe` の型）を使うと、画面なしで SNAPDBLib の計算（`CalcOutouMyu` など）を引数を変えて呼べる。「どの条件で効くか」を調べるのに便利（issue 0002・0007 はこれで α が効く条件を見つけた）。

- `[Reflection.Assembly]::UnsafeLoadFrom('<repo>\Aggre-SE\Headless\bin\Release\SNAPDBLib.dll')` を先に、`[Reflection.Assembly]::LoadFrom('<repo>\tests\Aggre-SE.Test\bin\Release\Batch.exe')` の型 `CSNAPDBEx` を `[Activator]::CreateInstance($t,@($db1,$false))`（第2引数は `$false`）で作る。
- `CalcOutouMyu` は 8 引数と 9 引数の 2 つがあるので、`GetMethods()` で引数の数を選ぶ。
- 全 DB1 を 1 本のスクリプトで回すと 120 秒以上止まる。DB1 ごとに `powershell.exe` を分け、`timeout` を付けて 1 本ずつ実行する。
