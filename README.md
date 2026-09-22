# イマセキ

空席を抱えた飲食店と、いま食べる場所を探している人を、その場で結ぶ仕組み（読み: あきせき）。
AI HACK 2026 の提出物。Next.js（`web/`）＋ Cloudflare Workers（D1・R2）＋ OrcaRouter 経由の AI。
仕様の正本は `docs/specs/v2/`（`requirements.md`・`design.md`・`tasks.md`）。v1 のデモ（`demo/`）と速成版（`sprint/`）はこのアプリからは触らない。

## 1. 触れる場所

https://ai-hack-v2.ai-shukyaku.workers.dev

- 客: `/me`
- 店: `/login`
- 運営: `/admin`

### 審査用のデモアカウント

⚠️ これは審査用のデモアカウントです。誰でも入れる状態なので、このアカウントで見えるデータはいつ書き換わってもおかしくありません。審査期間が終わったら入れ替えます。

| 用途 | URL | ログイン |
| --- | --- | --- |
| 客の画面 | `/me` | 不要（開いた瞬間に裏で登録が済む） |
| 入口 | `/` | 不要 |
| 店の新規登録 | `/store/register` | 不要 |
| 店の画面 | `/login` → `/store` | 下の表 |
| 運営の画面 | `/login` → `/admin` | 下の表 |

運営: `admin@imaseki.demo` / `Imaseki-Admin-2cf5e5ad518a`

店（6軒・パスワードは共通 `Imaseki-Demo-Store-2026`）:

| メールアドレス | 店 |
| --- | --- |
| `demo-store-1@example.com` | 喫茶 駿河台文庫 |
| `demo-store-2@example.com` | らーめん 駿台亭 |
| `demo-store-3@example.com` | 手打ちそば 小川町庵 |
| `demo-store-4@example.com` | 欧風カレー 神保町亭 |
| `demo-store-5@example.com` | 中華飯店 錦町楼 |
| `demo-store-6@example.com` | とんかつ 猿楽亭 |

## 2. 何を解決するか

急に客足が途切れて席が空いた飲食店には、呼び込みに出る人手も、SNS に書いて反応を待つ時間もない。渋谷で店を探している客の側も、電話をかけるのは気が重いし、店の前まで行って満席で断られるのを繰り返すと時間も気分も減る。イマセキは、店が募集する組数・何名まで・受付時間・見せるクーポンを決めてオファーを公開するだけで、そのとき近くにいて好みのジャンルと予算が合う客へ、システムが店を選んで理由つきで届ける仕組みだ。店が客の来店までに手を動かすのは、オファーを公開するときと、来た客を「完了済み」にするときの2回だけになる。

## 3. 仕組みの要点

- 客・店・運営、用途の異なる3つの画面を1つの Next.js アプリ（`web/`）にまとめ、Cloudflare Workers 上で動かす。データは D1、営業許可書の PDF は R2、AI は OrcaRouter 経由の1か所だけを通す。
- 判断はすべて副作用のない関数（`web/lib/domain/`）に集約している。画面の部品や API の入口は、その関数が返した結果をそのまま描くだけで、自分では判断しない。
- オファーの受付終了や確保の期限切れは、状態として保存せず、読むたびに「今の時刻」と比べて導く。だから段階配信を進めるための定期実行のジョブ（Cron Triggers・Durable Objects の alarm）を1つも持たない。
- 外部サービス（OrcaRouter・Google Maps Geocoding・Stripe・Web Push・Cloudflare Turnstile・R2）は、1サービスにつき1ファイルの差し替え口（`web/lib/adapters/`）からしか呼ばない。自動テストはこの口を偽物に差し替えて走らせる。
- AI が判断に関わるのは2か所だけ。決定論の絞り込みで上位10件まで絞った候補から最大5件を選んで理由を書く「店の選定」と、選ばれた店ごとの紹介文の生成・検査。紹介文の生成モデルと検査モデルは別ベンダーに分けてあり（`web/lib/adapters/orcarouter.ts` の `JUDGE_MODEL`）、書いた本人に採点させない。
- ログインなしで叩ける3つの入口（客の登録・店の登録・ログイン）に Cloudflare Turnstile を置き、確認が取れないときも拒否する。客の識別子は HttpOnly の Cookie に置き、画面のコードからは読めない。店と運営は自前のセッション（Cookie と D1）でログインする。

## 4. AI の使い方でとくに見てほしい点

紹介文を書かせるとき、`google/gemini-2.5-flash` は短い1文にも思考トークンを約1000使い、1回6.4〜8.9秒・$0.0026 かかっていた。OpenAI/OpenRouter 系の指定（`reasoning_effort`・`reasoning`・`thinking`）を5通り試したが、どれも黙って無視される。効いたのは1つだけで、ベンダー固有の `thinking_config.thinking_budget` を `extra_body` でそのまま渡す形だった。所要は1.0秒、費用は$0.00015まで落ちた（実装検証時の実測。同じ工夫はそのまま `web/lib/adapters/orcarouter.ts` の `NO_THINKING_EXTRA_BODY` に入っている）。

もう1つ分かったのは、`max_tokens` は思考と本文を合算して打ち切ること。上限を絞る道具に使うと、字数の検査は通るのに文が途中で切れてしまう。対処は上限を広く取り、`finish_reason === "length"` を検査で落とす経路を足すことで、これも `web/lib/adapters/orcarouter.ts` にそのまま実装した。

紹介文は生成のあと、決定論のガードと、生成とは別ベンダーのモデルによる判定を通す。判定のプロンプトを最初に書いたとき、禁止語「評価」を検査官が褒め言葉の意味で読み、「美味しい」を根拠不明な情報として不合格にしていた。不合格にする条件を3つ（存在しないデータを根拠にしている・渡していない情報を事実として書いている・不快な表現がある）に絞り、褒め言葉は通ると明記して直した。このプロンプトは `web/lib/adapters/orcarouter.ts` の `JUDGE_SYSTEM` に入っている。

紹介文は1店ごとに数秒かかるので、店のカードを先に返し、紹介文だけを NDJSON で後から差し込む形にした（`web/lib/usecases/streamOffers.ts`）。カードが出る `init` から最初の紹介文までは0.96〜1.7秒だった。

## 5. 手元で動かす

### 5.1 依存を入れる

リポジトリの直下（pnpm ワークスペースの根）で:

```bash
pnpm install
```

### 5.2 秘密の値を入れる（`web/.dev.vars`）

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

### 5.3 手元の D1 を用意する（migrations・`seed-admin`）

手元の D1（wrangler のローカル状態）へテーブルを作る:

```bash
pnpm --dir web exec wrangler d1 migrations apply ai-hack-v2 --local
```

運営のアカウントは画面からは作れない（基準 14.8）ので、スクリプトで投入する:

```bash
node web/scripts/seed-admin.mjs --email admin@example.com --password '<16字以上のパスワード>'
```

⚠️ 上の `admin@example.com` は手元の D1 に投入するための**例示の値**で、本番のパスワードではない。審査用の本番アカウント（本番の D1 に実在する値）は「1. 触れる場所」の「審査用のデモアカウント」を見る。

上のコマンドは手元の D1（`--local`）に運営のアカウントを作る／パスワードを入れ替える。
本番の D1 を書き換えたいときは、代わりに `--print` を付けて実行する。これは何も実行せず、そのまま貼れる `wrangler d1 execute … --remote` のコマンドを標準出力に出すだけ（確認なしに本番を書き換えない）:

```bash
node web/scripts/seed-admin.mjs --email admin@example.com --password '<16字以上のパスワード>' --print
```

### 5.4 開発サーバーを動かす

```bash
pnpm --dir web dev
```

### 5.5 型検査・lint・自動テスト

リポジトリの直下で:

```bash
pnpm exec tsc --noEmit -p tsconfig.json   # 型検査（web/ と tests/ の両方）
pnpm --dir web exec eslint .              # lint（web/ の中）
pnpm exec vitest run                      # 自動テスト（web/ の単体テスト・tests/acceptance/v2/ の受け入れ検査）
```

## 5.6 ダミーデータを作る

店・客・オファー・クーポンを自分で用意したいときは **[`docs/dummy-data.md`](docs/dummy-data.md)** を見てください。
テーブルごとの形、JSON の配列で持つ列、値の範囲のほか、**スキーマだけ見ると踏む落とし穴4つ**
（承認しないと検索に出ない／オファーの挿入は条件つきで黙って0行になる／座標は直に入れる／
起点から 800m を超えると1件も出ない）を書いてあります。

いちばん速いのは `web/scripts/seed-demo.mjs` の店の配列を差し替えることです。

## 6. 公開の手順

Cloudflare の D1・R2 が未作成なら先に用意する（在れば何もしない）:

```bash
scripts/v2-keys.sh cloudflare
```

ビルドして Cloudflare Workers へ公開する（`web/package.json` の `deploy` スクリプト。内部で OpenNext のビルド→`wrangler deploy` の順に実行する）:

```bash
pnpm --dir web run deploy
```

Worker の秘密（5.2 の6つ）は、初回の公開のあとに Cloudflare 側へ送る（未送信なら送る）:

```bash
scripts/v2-keys.sh push
```

現在 https://ai-hack-v2.ai-shukyaku.workers.dev で公開中。

## 7. 提出前の確かめ

### 7.1 自動テストが全部通る

```bash
pnpm exec vitest run
```

### 7.2 10回の取得が8秒以内（基準 4.13）／`orcarouter/auto` と `orcarouter/ai-sekitori` を比べる（OrcaRouter の使い方の手順⑤）

記事に貼る数字を出す手順。**先に固定するものを固定してから回す**（途中で条件が変わると比べた数字にならない）:

1. **固定する**: 同じ場所（住所の文字）・同じ人数・同じ好み（ジャンルと予算）を決め、種データの店（公開中のオファーを持つ店を10件以上）を流し込む。取得の間、店の側の操作はしない。
2. **記録の起点を取る**: 運営の数字の画面（`/admin/metrics`）を開き、モデル別の表の件数を控える（回す前の値。あとで引く）。
3. **`orcarouter/auto` で10回**: `web/wrangler.jsonc` の `vars.ORCAROUTER_MODEL` を `orcarouter/auto` にして公開し直し、1の条件で取得を10回行う。各回の所要時間が **8秒以内**であることを見る（基準 4.13 の確かめはここで済む）。
4. **Named Router で10回**: `ORCAROUTER_MODEL` を `orcarouter/ai-sekitori` に戻して公開し直し、同じ条件で取得を10回行う。
5. **表を読む**: 運営の数字の画面のモデル別の表から、モデルごとの件数・平均実費・平均所要時間・検査落ち率・倒れた率と、受け皿が答えた件数を控える。3と4の差が記事に貼る数字。
6. **突き合わせる**: 控えた `request_id` を1〜2件、OrcaRouter の管理画面の実費の記録と突き合わせ、記録の実費が合っていることを確かめる（記事の数字の裏取り）。
7. **戻す**: `ORCAROUTER_MODEL` を提出版の値 `orcarouter/ai-sekitori` に戻して公開し直す。

⚠️ 鍵 `AIHACK` の予算上限は $1/日なので、20回の取得がその中に収まることを、3の途中で管理画面の実費を1回見て確かめる（超えそうなら回数を減らし、記事にはその回数を書く）。

### 7.3 実機の確かめ

- スマホの実機（iPhone・Android）で、客の登録からホーム画面への追加・通知の許可・確保までひととおり触る。
- iPhone は**ホーム画面に追加した場合だけ**プッシュが届く（Safari 単体では届かない）。ホーム画面側は Safari と Cookie を共有しないので、その前提で客の画面の案内を確認する。
- 明暗の両対応（画面の設定を切り替えて色が破綻しないか）もこのタイミングで見る。

### 7.4 Turnstile の確かめ

- 手元と自動テストでは、Cloudflare が配布している「必ず通るテスト用の鍵」を使う（客の登録・店の登録・ログインの3つのフォーム）。
- ふつうの利用者としてフォームを送るとき、何も押さずに通ることを確かめる。
- ブラウザの開発者ツールなどで確かめの値（トークン）を送らずにフォームを送信し、決まった断りの文が出て、AI も地図も呼ばれないことを確かめる（`TURNSTILE_SECRET_KEY` を使うサーバー側の検証が効いていることの確認）。
