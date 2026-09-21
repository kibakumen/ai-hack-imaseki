# ai-hack v2

大会向けの提出物。Next.js（`web/`）＋ Cloudflare Workers（D1・R2）＋ OrcaRouter 経由の AI。
仕様の正本は `docs/specs/v2/`（`requirements.md`・`design.md`・`tasks.md`）。v1 のデモ（`demo/`）と速成版（`sprint/`）はこのアプリからは触らない。

## 1. 手元で動かす

### 1.1 依存を入れる

リポジトリの直下（pnpm ワークスペースの根）で:

```bash
pnpm install
```

### 1.2 秘密の値を入れる（`web/.dev.vars`）

秘密は `web/.dev.vars`（git の対象外）に置く。まず雛形をコピーする:

```bash
cp web/.dev.vars.example web/.dev.vars
```

`web/.dev.vars.example` に載っている名前がそのまま必要な秘密の一覧（値はここでは書かない）:

| 名前 | 何の鍵か |
| --- | --- |
| `ORCAROUTER_API_KEY` | OrcaRouter（AI の呼び出し）の API キー |
| `GOOGLE_MAPS_API_KEY` | Google Maps Geocoding API の鍵 |
| `STRIPE_SECRET_KEY` | Stripe（カード登録・setup モード）のテスト用シークレットキー |
| `VAPID_PRIVATE_KEY` | Web Push（VAPID）の秘密鍵 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile（ボット対策）のシークレットキー |
| `ADMIN_CONTACT_EMAIL` | 運営の連絡先メールアドレス（ログイン画面に出す値。秘密ではないが、公開リポジトリの `web/wrangler.jsonc` には置かず、他の秘密と同じ置き場にしている） |

秘密ではなく公開してよい値（Turnstile のサイトキー・VAPID の公開鍵・呼ぶモデル名）は `web/wrangler.jsonc` の `vars` に既に書かれており、手元でもそのまま読まれる。

鍵を1つずつ対話式で入れたい場合、または Cloudflare の Worker の秘密（`wrangler secret put`）へも同時に送りたい場合は `scripts/v2-keys.sh` が使える（値は画面に出ない）:

```bash
scripts/v2-keys.sh check       # 何が入っていて何が未設定か（値は出さない）
scripts/v2-keys.sh all         # 未設定の秘密を順に聞いて web/.dev.vars と Cloudflare の両方へ入れる
scripts/v2-keys.sh vapid       # VAPID の鍵の組を作って入れる
```

⚠️ `scripts/v2-keys.sh` は入力した鍵が会話に残らないよう、本人が自分の端末で直接実行する（Claude Code の `!` 経由では実行しない）。

### 1.3 手元の D1 を用意する（migrations・`seed-admin`）

手元の D1（wrangler のローカル状態）へテーブルを作る:

```bash
pnpm --dir web exec wrangler d1 migrations apply ai-hack-v2 --local
```

運営のアカウントは画面からは作れない（基準 14.8）ので、スクリプトで投入する:

```bash
node web/scripts/seed-admin.mjs --email admin@example.com --password '<16字以上のパスワード>'
```

上のコマンドは手元の D1（`--local`）に運営のアカウントを作る／パスワードを入れ替える。
本番の D1 を書き換えたいときは、代わりに `--print` を付けて実行する。これは何も実行せず、そのまま貼れる `wrangler d1 execute … --remote` のコマンドを標準出力に出すだけ（確認なしに本番を書き換えない）:

```bash
node web/scripts/seed-admin.mjs --email admin@example.com --password '<16字以上のパスワード>' --print
```

### 1.4 開発サーバーを動かす

```bash
pnpm --dir web dev
```

### 1.5 型検査・lint・自動テスト

リポジトリの直下で:

```bash
pnpm exec tsc --noEmit -p tsconfig.json   # 型検査（web/ と tests/ の両方）
pnpm --dir web exec eslint .              # lint（web/ の中）
pnpm exec vitest run                      # 自動テスト（web/ の単体テスト・tests/acceptance/v2/ の受け入れ検査）
```

## 2. 公開の手順

Cloudflare の D1・R2 が未作成なら先に用意する（在れば何もしない）:

```bash
scripts/v2-keys.sh cloudflare
```

ビルドして Cloudflare Workers へ公開する（`web/package.json` の `deploy` スクリプト。内部で OpenNext のビルド→`wrangler deploy` の順に実行する）:

```bash
pnpm --dir web run deploy
```

Worker の秘密（1.2 の6つ）は、初回の公開のあとに Cloudflare 側へ送る（未送信なら送る）:

```bash
scripts/v2-keys.sh push
```

⚠️ **このリポジトリは、この文書を書いている時点ではまだ本番へ公開されていない**（初回公開はこれから行う）。

## 3. 提出前の確かめ

### 3.1 自動テストが全部通る

```bash
pnpm exec vitest run
```

### 3.2 10回の取得が8秒以内（基準 4.13）／`orcarouter/auto` と `orcarouter/ai-sekitori` を比べる（OrcaRouter の使い方の手順⑤）

記事に貼る数字を出す手順。**先に固定するものを固定してから回す**（途中で条件が変わると比べた数字にならない）:

1. **固定する**: 同じ場所（住所の文字）・同じ人数・同じ好み（ジャンルと予算）を決め、種データの店（公開中のオファーを持つ店を10件以上）を流し込む。取得の間、店の側の操作はしない。
2. **記録の起点を取る**: 運営の数字の画面（`/admin/metrics`）を開き、モデル別の表の件数を控える（回す前の値。あとで引く）。
3. **`orcarouter/auto` で10回**: `web/wrangler.jsonc` の `vars.ORCAROUTER_MODEL` を `orcarouter/auto` にして公開し直し、1の条件で取得を10回行う。各回の所要時間が **8秒以内**であることを見る（基準 4.13 の確かめはここで済む）。
4. **Named Router で10回**: `ORCAROUTER_MODEL` を `orcarouter/ai-sekitori` に戻して公開し直し、同じ条件で取得を10回行う。
5. **表を読む**: 運営の数字の画面のモデル別の表から、モデルごとの件数・平均実費・平均所要時間・検査落ち率・倒れた率と、受け皿が答えた件数を控える。3と4の差が記事に貼る数字。
6. **突き合わせる**: 控えた `request_id` を1〜2件、OrcaRouter の管理画面の実費の記録と突き合わせ、記録の実費が合っていることを確かめる（記事の数字の裏取り）。
7. **戻す**: `ORCAROUTER_MODEL` を提出版の値 `orcarouter/ai-sekitori` に戻して公開し直す。

⚠️ 鍵 `AIHACK` の予算上限は $1/日なので、20回の取得がその中に収まることを、3の途中で管理画面の実費を1回見て確かめる（超えそうなら回数を減らし、記事にはその回数を書く）。

### 3.3 実機の確かめ

- スマホの実機（iPhone・Android）で、客の登録からホーム画面への追加・通知の許可・確保までひととおり触る。
- iPhone は**ホーム画面に追加した場合だけ**プッシュが届く（Safari 単体では届かない）。ホーム画面側は Safari と Cookie を共有しないので、その前提で客の画面の案内を確認する。
- 明暗の両対応（画面の設定を切り替えて色が破綻しないか）もこのタイミングで見る。

### 3.4 Turnstile の確かめ

- 手元と自動テストでは、Cloudflare が配布している「必ず通るテスト用の鍵」を使う（客の登録・店の登録・ログインの3つのフォーム）。
- ふつうの利用者としてフォームを送るとき、何も押さずに通ることを確かめる。
- ブラウザの開発者ツールなどで確かめの値（トークン）を送らずにフォームを送信し、決まった断りの文が出て、AI も地図も呼ばれないことを確かめる（`TURNSTILE_SECRET_KEY` を使うサーバー側の検証が効いていることの確認）。
