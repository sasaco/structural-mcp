# structural-mcp のスキル

structural-mcp が公開する解析エンジン（Aggre-SE、Capacita、FEMPython、SoilStructure、JRSNAP）と、橋脚自動設計アプリ WebPier を扱うための、Claude Code と Codex 用のスキルです。ここが唯一の正で、ユーザー全体（グローバル）のスキルとして配ります。案件ごとにコピーしません。計画と経緯は `.claude/docs/plans/global-engine-skills-plan.md`。

## 置く知識と置かない知識

| 層 | 置き場所 |
|---|---|
| エンジンの性質（書式、項目の意味、runner の挙動、版による違い） | ここ（`structural-<engine>/`） |
| WebPier の使い方（入力の意味、段階と依存、成果物、照査の中身） | ここ（`structural-webpier/`） |
| WebPier の開発（実装、決定番号、受入、テストの期待値） | WebPier の `.claude/skills/webpier-*` |
| 案件の判断（その構造物の条件、発注者とのやり取り、見本の読み替え） | 各案件の repo |

## 書き方

- フォルダー名と frontmatter の `name` は `structural-<小文字とハイフン>` で同じにする。案件側では `structural-*` の名前を使わない（Codex は同じ名前を両方並べる）。
- SKILL.md は **BOM なしの UTF-8**。BOM が付くと Codex はスキルを一覧に出さない。Windows PowerShell 5.1 の `Set-Content -Encoding utf8`・`Out-File` は BOM を付けるので使わない。
- `description` は 1024 文字以内。いつ使うかをエンジン中心に書き、案件の名前や決定番号を入れない（全セッションの文脈に入るため）。
- SKILL.md は 200 行以内を目安にし、詳細は `references/`、道具は `scripts/` に置く。本文からは**スキルのフォルダーからの相対パス**（`scripts/x.ps1`、`references/y.md`）で参照する。`.claude\skills\...` のような案件のパスで書かない。
- 環境ごとに違う場所は書き込まない。
  - runner：環境変数（`STRUCTURAL_MCP_AGGRESE_RUNNER` など）か MCP の `get_capabilities`／`get_environment_template` で調べる。
  - ソース：「開発機のみ。structural-mcp の repo のルートから」と書いて、repo からの相対パスで示す。MSI の利用者にはソースがない。
  - 利用者のフォルダー（`C:\Users\<名前>`）、ネットワークドライブ、見本データの絶対パスは書かない（`tests/skills.test.ts` が検査する）。
- MCP ツールがある操作は MCP を先に案内し、runner・CLI を直接呼ぶ方法はスクリプトから使う場合の手段として書く。
- 事実ごとに「コードで確認／実アプリで確認／推定」と、確かめた日と版（例：Batch 5.3.0.1、JRSNAP 5.2-L03）を残す。

## 知見を足すとき

- エンジンの性質・WebPier の使い方：ここを編集し、structural-mcp で commit する。開発機ではインストール先がこのフォルダーへのジャンクションなので、編集はそのまま全案件に効く。
- WebPier の実装・決定・受入：WebPier の repo。
- 案件のこと：その案件の repo。
- インストール先がコピー（MSI の利用者）のときは編集しない。案件側に書いて開発者に伝える。

## 配る

```powershell
npm run skills:install     # ~/.claude/skills と ~/.agents/skills にジャンクションを作る
npm run skills:status      # 置かれているか、リンク先・コピーの差を表示
npm run skills:uninstall   # このスクリプトが置いたものだけを消す
node scripts/install-skills.mjs install --mode copy   # ジャンクションを使わずにコピーする
```

- Claude Code は `~/.claude/skills`（`CLAUDE_CONFIG_DIR` があればその下）、Codex は `~/.agents/skills` を読む（2026-10-19、Claude Code 2.1.303・Codex 0.163.0 で確認。両方ともジャンクションを辿る）。
- 同じ名前の他人のスキルやリンクがあると、何も変更せずに止まる。
- 置いた記録は `.structural-mcp/skills-install-state.json`。ここから消したスキルは、次の `install` でインストール先からも消える。
- 新しいスキルは、新しいセッションから見える。
