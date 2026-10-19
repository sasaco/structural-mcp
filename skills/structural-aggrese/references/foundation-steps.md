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

## Batch 側のテスト

開発機のみ。structural-mcp の repo のルートから `Batch/tests/Aggre-SE.Test/HeadlessRunnerTests.cs`（9c70f54 以降）：

- PHC（杭基礎）の見本で CSV が返らないこと。
- 直接基礎（既定は Batch の repo のルートの隣の `WebPier/post/線路方向.xml`、環境変数 `AGGRE_SE_TEST_DIRECT_FOUNDATION_XML` で差替え、なければ skip）で、各行を `CSNAPDBEx` から読み直して照合する。
- `summary.outputs` は result.json を含まず、帳票を作らない呼び出しでは `cases[].aggregated` が false になる（既存の仕様）。
