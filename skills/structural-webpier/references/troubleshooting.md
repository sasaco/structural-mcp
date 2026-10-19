# うまくいかないとき

確かめた版：WebPier `b6c349c`、structural-mcp `91d7aca`（2026-10-19）。

## エラーコード（`errors[0].code`）

| コード | 意味 | すること |
|---|---|---|
| `INPUT_ERROR` | 入力が読めない・足りない・範囲外。`path` に項目のパス（パスのないものは選択の誤りなど） | `path` の項目を資料で確かめて直す。資料で決まらなければ利用者に聞く。直したら `webpier_validate` で次のエラーを見る（1件ずつ返る） |
| `RUNNER_UNAVAILABLE` | 選んだ段階が要る runner がない（`summary.missingRunners`） | 足りない runner を利用者に伝える。回り道はしない。`webpier_get_contract` で使える段階を選び直す |
| `ENGINE_FAILED` | runner（FEMPython・Capacita・JRSNAP・Aggre-SE）が失敗した | メッセージにエンジンの理由がある。入力が原因（解析できない形、照査できない配筋）なら入力を見直す。エンジンそのものはそのエンジンのスキル（`structural-capacita`・`structural-aggrese`・`structural-jrsnap-input`） |
| `GENERATION_FAILED` | 計算書が組めない、生成中に入力や WebPier が変わった | 入力を生成中に書き換えていないか確かめて、もう一度生成する。帳票が組めないのは WebPier の不具合なので開発者に伝える |
| `IO_ERROR` | ファイルの読み書きの失敗 | 下の「パスが長い」 |
| `INVALID_ARGUMENT` | runner の引数の誤り | MCP からは起きない想定。起きたら開発者に伝える |
| `RECOVERY_REQUIRED` | 公開に失敗して戻せないファイルがある | MCP の出力先は空なので起きない想定 |

MCP の側で止まったとき（`ok: false`、`category`）：`engine_unavailable`（WebPier の runner そのものがない。`get_environment_template` の `STRUCTURAL_MCP_WEBPIER_RUNNER`）、`calculation` の `request_failed`（入力の指定の誤り：`inputPath` と `input` の両方・どちらもない、JSON のオブジェクトでない、`.json` でない、allowed root の外）。

## よくある入力エラー

- `入力項目がありません: …`：キーが欠けている。全部のキーを書き、値がなければ `null`。
- `…: 未知の入力項目です`：綴りの違うキー、知らないキー。
- `…: 値が必要です`：その選択で要る値が `null`。
- 印字桁より細かい値（`m` で4桁以上など）：丸めた値を書く（何桁で丸めたかを `出典` に）。
- `杭種`：「直接基礎」以外は計算できない。
- 支持層の `内部摩擦角_φd` が 25 度未満、支持層が粘性土（0612・0622）。

## runner がない

- `webpier_get_contract` の `runners[].available` が false の runner は、server が見つけていない。runner の場所は `get_environment_template`（`engine: "all"`）で分かる。
- JRSNAP がない PC：`all` は使えない（0710・0720 が JRSNAP の図を要る）。0500・0600・0610〜0622 を段階ごとに作る。
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
