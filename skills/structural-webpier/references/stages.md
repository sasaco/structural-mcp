# 段階・依存・runner・成果物

いまの環境での正は `webpier_get_contract`（WebPier の登録表 `webpier/pipeline/stages.py` から作る）。この表はその写しで、WebPier `b6c349c` の contract で確認した（2026-10-19）。0400 と節の番号は WebPier `bb4a2cf`、配筋図は `89857d0` のコードで確認（2026-10-21）。

## 段階

| 段階 | 内容 | 依存 | 出力項目 | `output/` | `post/`（各ファイルに付帯JSON `<名前>.provenance.json`） |
|---|---|---|---|---|---|
| 0400 | 照査の前提（柱・梁・フーチングの構造細目、配筋図） | — | `detailing` | `0400_照査の前提` | `配筋図.dxf` |
| 0500 | 直接基礎の地盤ばね・支持力係数 | — | `ground_model` | `0500_直接基礎.pdf`・`.json` | — |
| 0500（杭基礎） | 杭基礎の地盤のモデル化（SOIL-JR 5.2-L03 に計算させる。帳票は SOIL-JR のもの） | — | `ground_model` | `0500_杭基礎.pdf`（SOIL-JR の帳票そのまま）・`.json` | `杭基礎.sdt`（入力）・`杭基礎.sdr`（設計限界値）・`杭基礎.sdc`（解析用地盤ばね）、液状化を考慮するとき `杭基礎(液状化時用).sdr`・`.sdc` |
| 0600 | 上部工反力・橋脚自重・移動荷重の反力 | — | `reactions` | `0600_上部工反力` | — |
| 0610 | 線路方向荷重（20基本ケース・16組合せ） | 0500・0600 | `longitudinal` | `0610_線路方向荷重` | `線路方向.json`（FrameWeb 入力） |
| 0611 | 線路方向の柱の断面照査（8.5〜8.10） | 0610 | `longitudinal_frame_analysis` | `0611_線路方向照査` | `線路方向.pik`・`線路方向_ピックアップ変位量.csv`・`線路方向_ピックアップ反力.csv`・`線路方向.wdj` |
| 0612 | 線路方向の基礎の照査（8.11） | 0500・0610 | `longitudinal_frame_analysis` | `0612_線路方向基礎` | 0611 と同じピックアップ3つ |
| 0620 | 直角方向荷重（17基本ケース） | 0500・0600 | `transverse` | `0620_直角方向荷重` | `線路直角方向.json` |
| 0621 | 直角方向の柱の断面照査（9.5〜9.10） | 0620 | `transverse_frame_analysis` | `0621_直角方向照査` | `線路直角方向.pik`・同 CSV 2つ・`線路直角方向.wdj` |
| 0622 | 直角方向の基礎の照査（9.11） | 0500・0620 | `transverse_frame_analysis` | `0622_直角方向基礎` | 0621 と同じピックアップ3つ |
| 0710 | 地震時の線路方向荷重（JRSNAP の入力） | 0500・0600 | `longitudinal_seismic` | `0710_線路方向荷重` | `線路方向.ndu` |
| 0711 | 線路方向の静的非線形解析と耐震性能照査 | 0710 | `longitudinal_nonlinear_analysis` | `0711_線路方向非線形解析` | フォルダー `線路方向_JRSNAP/`、`線路方向.xml`、`線路方向_Aggre-SE.pik`・`.xlsx`・`_直接基礎.csv` |
| 0720 | 地震時の線路直角方向荷重 | 0500・0600 | `transverse_seismic` | `0720_線路直角方向荷重` | `線路直角方向.ndu` |
| 0721 | 線路直角方向の静的非線形解析と耐震性能照査 | 0720 | `transverse_nonlinear_analysis` | `0721_線路直角方向非線形解析` | `線路直角方向_JRSNAP/`、`線路直角方向.xml`、`線路直角方向_Aggre-SE.*` |
| 0800 | フーチングの応答値（12.1、両方向） | 0500・0610・0612・0620・0622・0710・0711・0720・0721 | `footing` | `0800_フーチング` | — |
| 0810 | 線路方向のフーチングの断面照査（12.2〜12.5） | 0800 | `footing` | `0810_線路方向フーチング照査` | `線路方向フーチング.wdj` |
| 0820 | 直角方向のフーチングの断面照査（12.6〜12.9） | 0800 | `footing` | `0820_直角方向フーチング照査` | `線路直角方向フーチング.wdj` |
| 0900 | 片持ち梁の応答値と作用の組合せ（13.1・13.2） | 0600・0711・0721 | `cantilever` | `0900_片持ち梁` | — |
| 0910 | 片持ち梁の断面照査（13.3〜13.8。外観の照査ありは 13.9 まで） | 0900 | `cantilever` | `0910_片持ち梁照査` | `片持ち梁.wdj` |

`output/` の列は `.pdf` と `.json` の組。出力項目は入力の `outputs.*`（WebPier の決定72）。

## 出力項目と、作るもの・呼ぶ runner

作る計算書は入力の `outputs` だけで決まる（ツール・CLI・runner の引数では選ばない）。項目を `true` にするときは、それが使う項目も `true` にする（SKILL.md の表）。選んだ項目の段階をすべて作り直し、選ばなかった項目の成果物は残す。

| `true` にする項目 | 作る計算書 | runner |
|---|---|---|
| `ground_model`・`reactions`・`longitudinal`・`transverse`・`longitudinal_seismic`・`transverse_seismic` | 0500・0600・0610・0620・0710・0720 | FEMPython・JRSNAP |
| `ground_model`・`reactions`・`longitudinal_seismic`・`transverse_seismic` | 0500・0600・0710・0720（決定78：0610・0620 なし） | JRSNAP |
| 上に `longitudinal_frame_analysis`・`transverse_frame_analysis` | 上に 0611・0612・0621・0622 | FEMPython・JRSNAP・Capacita |
| 上の6項目に `*_nonlinear_analysis` 2つと `cantilever` | 上の6段階に 0711・0721・0900・0910 | 4つすべて |
| 13項目すべて | 全18段階 | 4つすべて |
| `detailing` だけ | 0400 | なし |
| `ground_model` だけ（`reactions` だけ） | 0500（0600） | なし |
| `ground_model`・`reactions`・`longitudinal` | 0500・0600・0610 | FEMPython |
| それに `longitudinal_frame_analysis` | 0500・0600・0610・0611・0612 | FEMPython・Capacita |

- 0611 と 0612（0621 と 0622）は1つの出力項目で、同じ FrameWeb 入力を解析するので、骨組解析は1回で、ピックアップのファイルは1組だけ。
- 0610・0620 の荷重図は FEMPython が、0710・0720 のデータ確認図と荷重図は JRSNAP が描いて計算書に差し込む。**地震時の項目（0710・0720）は JRSNAP の runner が要る**。JRSNAP がなければ地震時以外の項目だけを `true` にして作る。
- `webpier_get_contract` の `outputs[].runners` は、その項目を選ぶときに呼ぶ runner（使う項目の分も含む）。
- runner の名前：`fempython`（`STRUCTURAL_MCP_FEMPYTHON_RUNNER`）、`webdan2`＝Capacita（`STRUCTURAL_MCP_WEBDAN_RUNNER`）、`jrsnap`（`STRUCTURAL_MCP_JRSNAP_RUNNER`）、`aggrese`（`STRUCTURAL_MCP_AGGRESE_RUNNER`）。

## 時間の目安（実アプリで確認、2026-10-19、開発機）

| 選択 | MCP の生成 |
|---|---|
| 0610 | 3秒 |
| 0612 | 4秒 |
| 0611 | 7秒 |
| 0711・0721 | 1方向数分（JRSNAP の画面が出る） |

## 入力が要る範囲

どの段階も入力の全部のキーを読み、形式（型・選択肢・印字桁・知らないキー）を確かめる。値が要るのは、選んだ出力項目の段階が使う項目だけ（`references/input-schema2.md` の「どの段階が使うか」）。
