# うまくいかないとき

確かめた版：WebPier `b6c349c`、structural-mcp `91d7aca`（2026-10-19）。

## エラーコード（`errors[0].code`）

| コード | 意味 | すること |
|---|---|---|
| `INPUT_ERROR` | 入力が読めない・足りない・範囲外。`path` に項目のパス（出力項目の誤りは `outputs`・`outputs.<項目>`） | `path` の項目を資料で確かめて直す。資料で決まらなければ利用者に聞く。直したら `webpier_validate` で次のエラーを見る（1件ずつ返る） |
| `RUNNER_UNAVAILABLE` | 入力の出力項目（`outputs`）が要る runner がない（`summary.missingRunners`） | 足りない runner を利用者に伝える。回り道はしない。`webpier_get_contract` で使える出力項目を確かめ、`outputs` を変えてよいかを利用者に確かめる |
| `ENGINE_FAILED` | runner（FEMPython・Capacita・JRSNAP・Aggre-SE）が失敗した | メッセージにエンジンの理由がある。入力が原因（解析できない形、照査できない配筋）なら入力を見直す。エンジンそのものはそのエンジンのスキル（`structural-capacita`・`structural-aggrese`・`structural-jrsnap-input`） |
| `GENERATION_FAILED` | 計算書が組めない、生成中に入力や WebPier が変わった | 入力を生成中に書き換えていないか確かめて、もう一度生成する。帳票が組めないのは WebPier の不具合なので開発者に伝える（例：`0600の帳票を作成できません: … needs 509.85 pt; available width is 406.32 pt` は式が1行に入らない。P7橋脚の 61.39 m の桁に 12 軸が載ったときで、WebPier で直した）。0710・0720 の `組合せ … の荷重図に CASE-… のページがありません` は JRSNAP の荷重図のページが足りない（荷重のないケース。WebPier で直した） |
| `IO_ERROR` | ファイルの読み書きの失敗 | 下の「パスが長い」 |
| `INVALID_ARGUMENT` | runner の引数の誤り | MCP からは起きない想定。起きたら開発者に伝える |
| `RECOVERY_REQUIRED` | 公開に失敗して戻せないファイルがある | MCP の出力先は空なので起きない想定 |

MCP の側で止まったとき（`ok: false`、`category`）：`engine_unavailable`（WebPier の runner そのものがない。`get_environment_template` の `STRUCTURAL_MCP_WEBPIER_RUNNER`）、`calculation` の `request_failed`（入力の指定の誤り：`inputPath` と `input` の両方・どちらもない、JSON のオブジェクトでない、`.json` でない、allowed root の外）。

## よくある入力エラー

- `入力項目がありません: …`：キーが欠けている。全部のキーを書き、値がなければ `null`。
- `…: 未知の入力項目です`：綴りの違うキー、知らないキー。
- `…: 値が必要です`：選んだ出力項目で要る値が `null`。
- `outputs.<項目>: outputs.<別の項目> も true が必要です`：使う項目が `false`。`outputs: 出力項目が選ばれていません`：13項目すべて `false`。
- 印字桁より細かい値（`m` で4桁以上など）：丸めた値を書く（何桁で丸めたかを `出典` に）。
- `SDT_REJECTED`（SOIL-JR の入力の検査が止めた。メッセージに SOIL-JR の文言、例：「ソイルセメント径D1を入力してください」）・`SOIL_CALC_FAILED`（杭先端の地盤ばねの第2勾配が負、など）・`BUSY`（同じ JRSNAP のインストール先で SOIL-JR が起動している）：杭基礎の 0500。入力の地盤の層・杭の諸元を確かめる。
- `outputs.<項目>: 場所打ち杭は未対応です（…で選べる出力項目: …）`：杭基礎で選べない出力項目を `true` にしている（杭基礎で選べる項目は段ごとに広がる。WebPier 決定84）。
- `杭基礎.…`：`値が必要です`（選んだ基礎形式の項目が `null`）、`千鳥配置は両方向とも奇数列が必要です`、`この列の杭がすべてなくなります`（抜く杭が多い）など。
- 支持層の `内部摩擦角_φd` が 25 度未満、支持層が粘性土（0612・0622）。
- `地盤データ.層: …の層厚の合計 … m が Df（…）を超えます`：支持層より上の層厚の合計が Df（H6＋H5＋min(df1, df2)）より大きい。資料の層厚を、上載土算定の地表面からの深さで写したか確かめる。
- `鉄筋.柱: La/d = … が1.25未満`：低せん断スパン部材（La/d＜1.25）で、WebPier の M-θ の自動算定の対象外。寸法・桁の高さを確かめる。

## 0400 が not_ok になる

- 0400 の判定（`engineeringStatus`）は WebPier が判定する細目だけから決まる。NG の項目は 4.2〜4.4 の表の「判定」の列で探す（参照先の Capacita の節の NG は含まない）。
- 見本 Example2 の配筋（`pre/input.json`）では、梁の上側の段の間のあき 32 mm が 4/3Dmax ＝ 33.3 mm に足りず not_ok になる（4.3 の鉄筋のあき）。見本の計算書は段のあきを照査していない。WebPier の不具合ではないので、配筋（段の間のあき・骨材の最大寸法）を資料で確かめる（2026-10-21、WebPier `89857d0` で確認）。
- 0400 だけを選んでも、配筋は柱・梁・フーチングの上面と下面、`片持ち梁の照査.外観の照査` まで要る。0800〜0820 はフーチングの上面が空欄でも作れるので、その入力に 0400 を足すと入力エラーになる。

## runner がない

- `webpier_get_contract` の `runners[].available` が false の runner は、server が見つけていない。runner の場所は `get_environment_template`（`engine: "all"`）で分かる。
- JRSNAP がない PC：杭基礎の `ground_model`（0500 が SOIL-JR を JRSNAP の runner で動かす）と、地震時の項目（`longitudinal_seismic`・`transverse_seismic` と、それを使う項目）は作れない（0710・0720 が JRSNAP の図を要る）。杭基礎は `detailing`・`reactions` だけが作れる。地震時以外の項目だけを `true` にして 0500・0600・0610〜0622 を作る。
- FEMPython がない PC：地震時以外の `longitudinal`・`transverse` と骨組解析・`footing` は作れない。地震時の項目は 0610・0620 を使わないので（WebPier の決定78）、`ground_model`・`reactions`・`*_seismic` と、その先の `*_nonlinear_analysis`・`cantilever`（JRSNAP・Aggre-SE・Capacita が要る）は作れる。
- Capacita の runner は WebPier には `.exe` で渡す（server が `.dll` の横の `WebDanforCS.Headless.exe` を探す）。`.exe` がないと Capacita を使う段階は `missingRunners` に `webdan2` が出る。

## パスが長い（`IO_ERROR`、`No such file or directory`）

WebPier は job の中に `output\output\.webpier-xxxxxxxx\.<ファイル名>.<8文字>.tmp` のような一時ファイルや JRSNAP の長いファイル名を作る。MCP の job root（`STRUCTURAL_MCP_JOB_ROOT`）が深いと 260 文字を超えて失敗する（実アプリで確認、2026-10-19）。job root を浅い場所にする（既定の `%LOCALAPPDATA%\structural-mcp\jobs` なら足りる）。MCP の設定の変更は利用者に頼む。

## 時間がかかる・タイムアウト

- server 側の上限は `STRUCTURAL_MCP_WEBPIER_TIMEOUT_MS`（既定30分、`get_capabilities` の `engines.webpier.timeoutMs`）。
- クライアント側の tool の上限にも当たる。Codex は `config.toml` の `[mcp_servers.<名前>]` に `tool_timeout_sec = 1800` がないと、静的非線形解析を含む生成が途中で切れる。
- JRSNAP は同じインストール先で同時に解析できない（JRSNAPHeadless が直列にする）。JRSNAP の画面を利用者が開いているとき、ほかの生成が JRSNAP を使っているときは待つ。

## 入力が allowed root の外

`input path is outside STRUCTURAL_MCP_ALLOWED_ROOTS`：ネットワークドライブの案件など。ファイルを読んで中身を `input` に文字列で渡す（BOM なしの UTF-8 ならバイトも SHA-256 も同じ）。allowed root を足すのは MCP の設定の変更なので利用者に頼む。

## 成果物を置けない

- `place-webpier-outputs.mjs` が「既にあるので置きません」：案件に前の成果物がある。置き換えてよいか利用者に確かめてから `--overwrite`。
- 「manifest と一致しません」：job の中のファイルが変わった。生成し直す。
- MCP サーバーが別の PC にある（job のフォルダーが見えない）：`read_artifact` で取り、`bytes`・`sha256` を確かめて書く。
