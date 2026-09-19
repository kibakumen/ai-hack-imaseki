# ai-hack

このファイルは**目次だけ**。中身は `docs/` にある。エージェントから見えないものは、エージェントにとって存在しない——決まったことは必ず `docs/` に書く。

## 仕様書

- 置き場所: `docs/specs/<仕様名>/`（仕様: `main`）
- 1仕様 = `intent.md`（意図）→ `requirements.md`（要件）→ `design.md`（設計）→ `tasks.md`（タスク表）
- 承認の記録: `docs/specs/<仕様名>/approvals.json`（`approve.mjs` だけが書く）
- 監査・反論・判定の記録: `docs/specs/<仕様名>/audits/`
- 受け入れ検査: `tests/acceptance/<仕様名>/`（設計者が書き、タスク表の承認後は固定）

## 進め方

`/dev ai-hack` を打つと、今の段を判定して次の作業へ進む。本人の承認は `/dev ai-hack approve`。
段・役割・品質ループの正本: vault の `knowledge/models/development/sdd/01_AI開発フロー.md`

## ゲートのコマンド

`dev.config.json` の `gate`（型検査・lint・テスト）。設計の段で技術構成が決まったら設計者が埋める。

## 役割と書ける場所

| 役割 | 書ける場所 |
| --- | --- |
| 設計者 | `docs/specs/**`・`tests/acceptance/**`（承認の記録と監査記録は除く） |
| 実行者 | それ以外のコード（仕様書・受け入れ検査・`dev.config.json`・`.git/**`・このファイルは除く） |
| 監査役・反論役 | どこにも書かない |
| 進行役 | `dev.config.json` の `gate`（本人に確認してから） |

**書ける場所の方針はスキル側（`~/.claude/skills/dev/scripts/lib/config.mjs` の定数）に固定**されており、このリポジトリの設定からは変えられない。
