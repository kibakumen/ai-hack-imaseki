# イマセキ

空席を抱えた飲食店と、いま食べる場所を探している人を、その場で結ぶ仕組み（読み: いませき）。
AI HACK 2026 の提出物。Next.js（`web/`）＋ Cloudflare Workers（D1・R2）＋ OrcaRouter 経由の AI。
仕様の正本は `docs/specs/v2/`（`requirements.md`・`design.md`・`tasks.md`）。2026-09-25 の監査の直しで変えた基準の一覧と理由は `docs/specs/v2/CHANGES-2026-09-25.md`。v1 のデモ（`demo/`）と速成版（`sprint/`）はこのアプリからは触らない。v1 の説明書 `docs/architecture.md` は v1 の記録で、今の製品の説明ではない。

`docs/specs/`（意図・要件・設計・タスク表・承認と監査の記録）と `docs/views/`（段ごとの図解）は、AI 駆動開発の過程の記録として意図して公開している（本人の原文の引用・監査の採点・承認の記録を含む・2026-09-26 本人選択）。このリポジトリの開発ハーネス（/dev）は提出で役目を終えて閉じたので、`docs/specs/v2/approvals.json` の指紋は今の文書と合わないまま残してある。

## 1. 触れる場所

**公開していたデモは、2026-09-25 から停止中。** 同日の監査で、公開の版に運営のアカウントを誰でも乗っ取れる穴などが見つかったため（監査の指摘 安全-01 ほか）、安全のために止めた。直した版を出し直すまで、公開先の URL はここに載せない。いま触るなら、手元で動かす（「5. 手元で動かす」）。出し直すときの順番は「6. 公開の手順」の 6.2。

画面の入口（手元で動かしたときの道）:

- 客: `/me`
- 店: `/login`
- 運営: `/admin`

### 審査用のデモアカウント

店の画面と運営の画面に入るためのログインの値（メールアドレスとパスワード）は、公開のリポジトリであるここには載せない。審査員へは提出フォームなど、公開されない経路で渡す（2026-09-25 の監査の指摘 安全-01: 載せた値で誰でも運営として入り、パスワードとメールアドレスを変えて本人と審査員を締め出せた）。一度公開した値は、消しても入れ替えるまで使える——入れ替えの手順は 5.3 の「乗っ取られた運営を取り返すとき・パスワードを入れ替えるとき」と「本番のデモ店のパスワードを入れ替えるとき」。

⚠️ デモ店のデータは審査用で、いつ書き換わってもおかしくない。デモを再開するときは、**公開の前に**運営とデモ店のパスワードを入れ替えてセッションを全部切る（6.2 の手順3・4）。

| 用途 | URL | ログイン |
| --- | --- | --- |
| 客の画面 | `/me` | 不要（開いた瞬間に裏で登録が済む） |
| 入口 | `/` | 不要 |
| 店の新規登録 | `/store/register` | 不要（店向けの利用規約 `/store/terms` への同意が要る） |
| 店の画面（デモ店6軒・会場の徒歩圏） | `/login` → `/store` | 別の経路で渡す値 |
| 運営の画面 | `/login` → `/admin` | 別の経路で渡す値 |
| 送信先と個人情報の扱い | `/privacy` | 不要（全画面の下からリンク） |

## 2. 何を解決するか

急に客足が途切れて席が空いた飲食店には、呼び込みに出る人手も、SNS に書いて反応を待つ時間もない。渋谷で店を探している客の側も、電話をかけるのは気が重いし、店の前まで行って満席で断られるのを繰り返すと時間も気分も減る。イマセキは、店が募集する組数・何名まで・受付時間・見せるクーポンを決めてオファーを公開するだけで、そのとき近くにいて好みのジャンルと予算が合う客へ、システムが店を選んで理由つきで届ける仕組みだ。店が客の来店までに手を動かすのは、オファーを公開するときと、来た客を「完了済み」にするときの2回だけになる。

## 3. 仕組みの要点

- 客・店・運営、用途の異なる3つの画面を1つの Next.js アプリ（`web/`）にまとめ、Cloudflare Workers 上で動かす。データは D1、営業許可書と店の画像は R2、AI は OrcaRouter 経由の1か所だけを通す。
- 判断はすべて副作用のない関数（`web/lib/domain/`）に集約している。画面の部品や API の入口は、その関数が返した結果をそのまま描くだけで、自分では判断しない。
- オファーの受付終了や確保の期限切れは、状態として保存せず、読むたびに「今の時刻」と比べて導く。だから段階配信を進めるための定期実行のジョブ（Cron Triggers・Durable Objects の alarm）は持たない。応答のあとに回す小さな手入れ（Google で直した店の位置の取り直し・どの店からも指されていない営業許可書の掃除）は、要求のついでに `waitUntil` で走る。定期実行は1本だけで、1日1回、Google で直した店の位置のうち29日（連続30日の上限 − 定期実行の間隔1日。次の回までに30日を超えないため）を過ぎたものを必ず消す（Google Maps Platform の Service Specific Terms 6.3.1。客が来ない日も期限を守るため・`web/wrangler.jsonc` の `triggers.crons` → `web/worker.mjs` → `web/lib/scheduled.ts`）。同じ定期実行で、数えの表 `rate_counters` のうち、いちばん長い窓（端末の印の信頼期間の30日）より古い行も消す（接続元×日の鍵の行が増え続けないため・2026-09-26）。
- 外部サービス（OrcaRouter・Google Maps の Geocoding と Places・Stripe・Web Push・Cloudflare Turnstile・R2）は、1サービスにつき1ファイルの差し替え口（`web/lib/adapters/`）からしか呼ばない。自動テストはこの口を偽物に差し替えて走らせる。どこへ何を送るかの一覧は `/privacy`（`web/app/privacy/page.tsx`）。
- AI が判断に関わるのは2か所だけ。決定論の絞り込みで上位10件まで絞った候補から最大5件を選んで理由を書く「店の選定」と、選ばれた店ごとの紹介文の生成・検査。紹介文の生成モデルと検査モデルは別ベンダーに分けてあり（`web/lib/adapters/orcarouter.ts` の `JUDGE_MODEL`。書き手と検査官の口は `orcarouterPitch.ts`）、書いた本人に採点させない。**呼び出しの数には上限がある**——店の選定は取得1回につき1回、紹介文は1店につき書き手と検査官を合わせて4回まで、取得1回の合計は21回まで（要件7の基準 7.2・`web/lib/usecases/writePitch.ts` の `AI_CALLS_PER_FETCH_MAX`）。アプリ全体でも、その日（日本時間）の AI の実費か回数が上限に届いたら、選定は点数順・紹介文は決まった文に倒す（値は `web/lib/schemas/limits.ts`）。
- ログインなしで叩ける3つの入口（客の登録・店の登録・ログイン）に Cloudflare Turnstile を置き、確認が取れないときも拒否する。客の識別子は HttpOnly の Cookie に置き、画面のコードからは読めない。店と運営は自前のセッション（Cookie と D1。使うたびに延びるが、作ってから14日で必ず切れる）でログインする。連打の抑止は、外のサービスを呼ぶ入口とログインに掛けてある（表は `web/lib/http/rateLimits.ts`）。全部の応答に CSP などの守りの見出しを付けている。

## 4. AI の使い方でとくに見てほしい点

紹介文を書かせるとき、`google/gemini-2.5-flash` は短い1文にも思考トークンを約1000使い、1回6.4〜8.9秒・$0.0026 かかっていた。OpenAI/OpenRouter 系の指定（`reasoning_effort`・`reasoning`・`thinking`）を5通り試したが、どれも黙って無視される。効いたのは1つだけで、ベンダー固有の `thinking_config.thinking_budget` を `extra_body` でそのまま渡す形だった。所要は1.0秒、費用は$0.00015まで落ちた（実装検証時の実測。同じ工夫はそのまま `web/lib/adapters/orcarouter.ts` の `NO_THINKING_EXTRA_BODY` に入っている）。

もう1つ分かったのは、`max_tokens` は思考と本文を合算して打ち切ること。上限を絞る道具に使うと、字数の検査は通るのに文が途中で切れてしまう。対処は上限を広く取り、`finish_reason === "length"` を検査で落とす経路を足すことで、これも `web/lib/adapters/orcarouter.ts` にそのまま実装した。

紹介文は生成のあと、決定論のガードと、生成とは別ベンダーのモデルによる判定を通す。判定のプロンプトを最初に書いたとき、禁止語「評価」を検査官が褒め言葉の意味で読み、「美味しい」を根拠不明な情報として不合格にしていた。不合格にする条件を3つ（存在しないデータを根拠にしている・渡していない情報を事実として書いている・不快な表現がある）に絞り、褒め言葉は通ると明記して直した。このプロンプトは `web/lib/adapters/orcarouterPitch.ts` の `JUDGE_SYSTEM` に入っている。店の選定の理由の文も、紹介文と同じ語の検査（`web/lib/domain/claims.ts`）を通す。

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
| `GOOGLE_MAPS_API_KEY` | Google Maps の Geocoding API と Places API の鍵 |
| `STRIPE_SECRET_KEY` | Stripe（カード登録・setup モード）のテスト用シークレットキー |
| `VAPID_PRIVATE_KEY` | Web Push（VAPID）の秘密鍵 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile（ボット対策）のシークレットキー |
| `ADMIN_CONTACT_EMAIL` | 運営の連絡先メールアドレス（ログイン画面と `/privacy` に出す値。秘密ではないが、公開リポジトリの `web/wrangler.jsonc` には置かず、他の秘密と同じ置き場にしている） |
| `RESEND_API_KEY` | （任意）Resend（メールの送信）の API キー。`MAIL_FROM` と**両方**入れたときだけ、店と運営のメールアドレスの確認が動く（2026-09-26 に取り込んだ機能・要件14の基準 14.23〜14.28）。どちらかが空なら確認の入口は 404 で、画面にも確認の帯は出ない |
| `MAIL_FROM` | （任意）確認メールの送信元（例 `イマセキ <noreply@送信元のドメイン>`）。Resend で認証済みのドメインのアドレスでなければ Resend が断る |

秘密ではなく公開してよい値（Turnstile のサイトキー・VAPID の公開鍵・呼ぶモデル名）は `web/wrangler.jsonc` の `vars` に既に書かれており、手元でもそのまま読まれる。

**手元の Turnstile は、Cloudflare が配布している試験用の鍵を使う**（2026-09-25 の監査の指摘 安全-23）。本番のウィジェットの許すホスト名から `localhost` を外したので、本番のサイトキーは手元では動かない。`web/.dev.vars` に、試験用のサイトキー `TURNSTILE_SITE_KEY="1x00000000000000000000AA"` と試験用の秘密鍵 `TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"` を置く（`.dev.vars` は `vars` を上書きする）。この2つは誰でも知っている公開の値で、答えを必ず通す。

鍵を1つずつ対話式で入れたい場合、または Cloudflare の Worker の秘密（`wrangler secret put`）へも同時に送りたい場合は `scripts/v2-keys.sh` が使える（値は画面に出ない）:

```bash
scripts/v2-keys.sh check       # 何が入っていて何が未設定か（値は出さない）
scripts/v2-keys.sh all         # 未設定の秘密を順に聞いて web/.dev.vars と Cloudflare の両方へ入れる
scripts/v2-keys.sh vapid       # VAPID の鍵の組を作って入れる
scripts/v2-keys.sh push        # web/.dev.vars の秘密（上の表のうち（任意）でない6つだけ）を Cloudflare の Worker の秘密へまとめて送る
```

⚠️ `scripts/v2-keys.sh` は入力した鍵が会話に残らないよう、本人が自分の端末で直接実行する（Claude Code の `!` 経由では実行しない）。
⚠️ `push` と `put` は、Turnstile の試験用の秘密鍵（`1x`・`2x`・`3x` で始まる）を Cloudflare へ送らずに止まる。手元を試験用の鍵にしている間は、本番の Turnstile の秘密鍵を `pnpm --dir web exec wrangler secret put TURNSTILE_SECRET_KEY --name ai-hack-v2` で別に入れる。

### 5.3 手元の D1 を用意する（migrations・`seed-admin`）

手元の D1（wrangler のローカル状態）へテーブルを作る:

```bash
pnpm --dir web exec wrangler d1 migrations apply ai-hack-v2 --local
```

運営のアカウントは画面からは作れない（基準 14.8）ので、スクリプトで投入する:

```bash
node web/scripts/seed-admin.mjs --email admin@example.com --password '<16字以上のパスワード>'
```

⚠️ 上の `admin@example.com` は手元の D1 に投入するための**例示の値**で、本番のパスワードではない。本番のログインの値はこのリポジトリに書かない（「1. 触れる場所」）。

上のコマンドは手元の D1（`--local`）に運営のアカウントを作る／パスワードを入れ替える。書く前に**今いる運営の一覧**を出し、同じメールアドレスの運営が在ればパスワードを入れ替えて、その運営のセッションを全部切る。**別のメールアドレスの運営が既にいると、黙って2人目を作らずに止まる**（何も書かない）。
本番の D1 を書き換えたいときは、代わりに `--print` を付けて実行する。これは何も実行せず、そのまま貼れる `wrangler d1 execute … --remote` のコマンドを標準出力に出すだけ（確認なしに本番を書き換えない）:

```bash
node web/scripts/seed-admin.mjs --email admin@example.com --password '<16字以上のパスワード>' --print
```

出るコマンドは bash にそのまま貼れる形（単一引用）になっている。パスワードの保存の値は `$` を含むので、二重引用に書き換えない（`$` の後ろを bash が変数として展開し、壊れた値が入る）。

#### 乗っ取られた運営を取り返すとき・パスワードを入れ替えるとき

1. `--print` で出すと、**先頭に今いる運営の一覧を出す文**（読むだけ）が出る。まずそれだけを本番で流し、運営の番号（`id`）とメールアドレスを確かめる。メールアドレスを変えられていても、ここで気づける。知らない運営が増えていれば、その行とそのセッションを消す。
2. 確かめた番号を `--account-id <番号>` に渡して出し直し、出た文を順に流す。その運営の**メールアドレスとパスワードを入れ替え、その運営のセッションを全部切る**（乗っ取った側の画面を残さない）。メールアドレスを変えずにパスワードだけ入れ替えるときも番号で指す——番号なしで出る文は「新しく作る」文で、同じメールアドレスが在ると UNIQUE で落ちる。
   ⚠️ メールアドレスの入れ替えの文は、アドレスが変わるときにメールアドレスの確認（`accounts.email_verified_at`・migration `0015`）を未確認へ戻す（2026-09-26）。**`0015` を当てたあとの本番で流す**（6.2 の手順3で migration を当ててから、手順4で取り返す順）。当てる前に流すと、列が無いと断られて何も変わらない。出した文を migration を全部当てた手元の D1 に流して取り返せることは `web/tests/seedScripts.test.ts` が確かめる。
3. 2人目の運営を本当に足すときだけ `--add` を付ける（付けないと、別の運営がいる手元の D1 では止まる）。当番ごとに別の運営アカウントを持つと、操作の記録（`admin_actions`）で誰が操作したかを見分けられる。

```bash
node web/scripts/seed-admin.mjs --email <運営のメールアドレス> --password '<16字以上の新しいパスワード>' --print
# 一覧を流して番号を確かめてから
node web/scripts/seed-admin.mjs --email <運営のメールアドレス> --password '<16字以上の新しいパスワード>' --account-id <番号> --print
```

#### 本番のデモ店のパスワードを入れ替えるとき

運営の画面の「仮のパスワードの発行」は、発行された店がログインの直後に新しいパスワードを決めるまでほかの操作を断られる（2026-09-25 の監査の指摘 安全-21）ので、審査員が共用するデモ店には向かない。代わりに、`seed-demo.mjs` の `--rotate-stores` で入れ替えの文だけを出して本番へ流す:

```bash
node web/scripts/seed-demo.mjs --rotate-stores --store-password '<新しい共通のパスワード>' --print
```

出るのは2つのコマンド（デモ店6軒のパスワードの入れ替えと仮のパスワードの印の解除 → そのセッションの削除）で、店・オファー・運営には触れない。この順に本番で流す。コマンドは運営の `--print` と同じく単一引用で出る——保存の値は `$` を含むので、手で写して二重引用の `--command "…"` に書き換えない（`$1…` や `$<塩>` を bash が変数として展開し、壊れた値が入って誰もデモ店に入れなくなる・2026-09-26 のレビュー）。`seed-demo.mjs … --print`（店を入れる文）はデモ店が既に在る本番には流さない（店が二重にできる・5.6）。

手元の D1 なら `seed-demo.mjs` を流し直すだけで、既にあるデモ店のパスワードを `--store-password` の値に入れ替えてセッションを全部切る（5.6）。

### 5.4 開発サーバーを動かす

```bash
pnpm --dir web dev
```

アプリのアイコン（PNG）は `web/scripts/make-app-icons.mjs` が `dev` と `build` の前に作る（追跡しない）。

### 5.5 型検査・lint・自動テスト

リポジトリの直下で:

```bash
pnpm exec tsc --noEmit -p tsconfig.json   # 型検査（web/ と tests/ の両方）
pnpm --dir web exec eslint .              # lint（web/ の中）
pnpm exec vitest run                      # 自動テスト（web/ の単体テスト・tests/acceptance/v2/ の受け入れ検査）
```

- 自動テストの並列数の既定は2（受け入れ検査は1ファイルごとに手元の D1 を立て、1本あたり約0.5GB を使うため）。速い機械では `VITEST_MAX_WORKERS=4 pnpm exec vitest run` のように広げる。
- まだ直っていない不具合を示す検査は `it.fails` で持ち、名前が「既知の不具合（<ID>）:」で始まる。結果に「expected fail」と出るのはそれ（直したら普通の `it` に戻す）。
- 受け入れ検査をタスクごとに絞る仕組み（着手の記録の無いタスクのブロックを飛ばす）は、環境変数 `ACCEPTANCE_TASK_GATE=1` を立てたときだけ効く。手元でそのまま走らせると全部走る。

## 5.6 ダミーデータを作る

店・客・オファー・クーポンを自分で用意したいときは **[`docs/dummy-data.md`](docs/dummy-data.md)** を見てください。
テーブルごとの形、JSON の配列で持つ列、値の範囲のほか、**スキーマだけ見ると踏む落とし穴4つ**
（承認しないと検索に出ない／オファーの挿入は条件つきで黙って0行になる／座標は直に入れる／
起点から 800m を超えると1件も出ない）を書いてあります。

いちばん速いのは `web/scripts/seed-demo.mjs` の店の配列を差し替えることです。運営の扱いは `seed-admin` と同じ（書く前に今いる運営の一覧を出す・別の運営がいれば2人目を作らずに止まる・`--admin-account-id <番号>` で取り返す・`--add` で2人目を足す）。流し直すと、既にあるデモ店のパスワードを `--store-password` の値に入れ替えてセッションを全部切り、止められた店は承認済みへ戻す。

## 6. 公開の手順

### 6.1 今は止めてある

v2 の Worker `ai-hack-v2` は 2026-09-25 から止めてある（「1. 触れる場所」）。止め方は2通りで、どちらでも D1 と R2 の中身は残る:

- **公開の道を切る**: Cloudflare の管理画面で Worker `ai-hack-v2` の設定から workers.dev の公開を切る（Worker の秘密は残る）
- **Worker を消す**: `pnpm --dir web exec wrangler delete ai-hack-v2`。Worker の秘密も消えるので、再開のときに送り直す（6.2 の手順7）

止めたら、公開先へ `curl -s -o /dev/null -w '%{http_code}' <公開先>` を当て、200 以外が返ることを確かめる。速成版の Worker `ai-hack-sekiari` も止める（古い鍵が公開の履歴に残っている・監査の指摘 安全-05）。

止めている間は、設定でも公開が戻らないようにしてある（2026-09-26）:

- `web/wrangler.jsonc` の `workers_dev: false`・`preview_urls: false`——`wrangler deploy` を打っても workers.dev の公開と版ごとの下見の URL は出ない
- `web/package.json` の `deploy` は、最初に `web/scripts/deploy-guard.mjs` を通る。合図 `ALLOW_DEPLOY=1` が無ければ、組み立ても migration も公開もせずに失敗で止まる。合図があっても、事業者の表記が「準備中」のままなら止まる（6.2 の手順6・2026-09-26）

### 6.2 再開の手順（この順番を守る）

公開の前に、本番の D1 にまだ当たっていない migration を確かめる（読むだけ・書き換えない）:

```bash
pnpm --dir web exec wrangler d1 migrations list ai-hack-v2 --remote
```

2026-09-25 の監査の直しで足した migration は次の表のとおり（2026-09-26 の最終の手直しの `0012` 以降と、2026-09-26 の本人選択で足した `0013`・本人発案で足した `0014`、同じ日に取り込んだメールアドレスの確認の `0015`、同じ日の本人発案のクーポンの保障の `0017` を含む）で、どれも本番には未適用（コードはこれが当たっている前提で動く。当てずにコードだけを出すと、列や制約が無いまま動いて500になる）:

| migration | 中身 |
| --- | --- |
| `0003_rate_counters_atomic.sql` | 連打の抑止の数えの表 `rate_counters` を主キー `key` だけの表へ作り直す（鍵ごとに新しい窓の行を移す）。AI の1日の上限を数える索引 `idx_ai_calls_at_daily_budget` を足す |
| `0004_reservation_phone_and_indexes.sql` | 確保の行に受け取った時点の電話番号の写し `reservations.customer_phone`（今ある行のうち確保中と店が取り消した行だけ、客の今の番号で埋める）と、店と記録の読み取りの索引 |
| `0006_fetch_origin_kind.sql` | 取得の記録に起点の種類 `fetch_logs.origin_kind`（`here`・`place`。今ある行は NULL） |
| `0007_offer_until_set.sql` | 店が「何時まで」を入れたかの印 `offers.until_set`（今ある行は1） |
| `0008_session_created_at.sql` | セッションを作った時刻 `sessions.created_at`。今ある行は NULL のまま残り、コードが切れたものとして断る＝**当てると店と運営は1度ずつ入り直す**（乗っ取った側のセッションもここで切れる） |
| `0009_google_terms.sql` | 店の位置を Google で直した時刻 `stores.geocoded_at`。今ある店は登録の時刻で埋める（デモの店＝メールアドレスが `@example.com` の店は外す） |
| `0010_store_terms.sql` | 店向けの利用規約への同意の版と時刻 `stores.terms_version`・`stores.terms_agreed_at` |
| `0011_admin_actions.sql` | 運営の操作の記録 `admin_actions`（追加だけ・トリガーで守る）と、承認した時点の写し・運営のメモ・連絡済みの印の列。当てると、承認済みと止められている店の今の値が承認の写しとして埋まる |
| `0012_pending_license_retention.sql` | 承認されていない店の営業許可書のうち、上げた時刻 `stores.license_uploaded_at` の無いものを、当てた時刻で埋める（上げてから30日たっても承認されない許可書を消す数えの起点・安全-20）。承認済みの店には触れない |
| `0013_store_no_show.sql` | 店の取り消しの理由 `reservations.cancel_reason` と、状態の変化の記録の理由 `reservation_events.reason`（「来ない（枠が戻る）」・2026-09-26 本人選択）。今ある行は NULL のまま（店の都合の取り消しとして読まれ、残りは動かない）。**当てずにコードだけを出すと、確保を読む問い合わせと状態の変化の記録が落ちる** |
| `0014_store_withdrawal.sql` | 店が退会した時刻 `stores.withdrawn_at`（2026-09-26 本人発案の店の退会・今ある行は NULL）。当てずに出すと運営の一覧と詳細が500になる |
| `0015_email_verification.sql` | メールアドレスの確認（2026-09-26 に枝 `feat/email-verify` から取り込んだ・その枝では `0003` だった番号を付け替えた）。`accounts.email_verified_at`（今ある行は NULL＝まだ確認していない）と、確認のリンクの控えの表 `email_verifications`（token は sha256 だけ）。メールを送る鍵（5.2 の `RESEND_API_KEY`・`MAIL_FROM`）を入れていなくても当ててよい（列と表が在っても使われないだけ） |
| `0016_fetch_origin_without_google_coordinates.sql` | 取得の記録 `fetch_logs` を作り直し、起点の座標の列を空を許す形にして、客が自分で打った場所の文字 `origin_place`（場所の候補から選んだ文字は書かない・今ある行は全部空から始まる）と Google の場所の番号 `origin_place_id` の列を足す。**今ある行のうち、打った場所で探した行と種類の分からない行（`origin_kind` が NULL）の座標を消す**（Google で直した座標は連続30日までしか置けない・Service Specific Terms 6.3.1。記録の表を追加だけとする基準 27.7 の1回だけの例外・2026-09-26 本人選択）。現在地で探した行の座標は残す。⚠️ 消した座標は戻せない（控えを取って残すと、同じ利用条件に反する） |
| `0017_fetch_item_coupons.sql` | 返した店1件の記録 `fetch_items` に、その結果で見せたオファーの番号 `offer_id` と客に見せたクーポンの写し `coupons_json` の列を足す（2026-09-26 本人発案（受諾した時点のクーポンを保障）。今ある行は NULL のまま＝写しの無い古い記録で、そこから受け取ると今までどおり受け取った時点のクーポンが写る）。**当てずにコードだけを出すと、取得の記録が書けず取得が落ちる** |

手順:

1. **直しが全部入った版か確かめる**。リポジトリの直下で 5.5 の3つが通ること。`web/tests/deployProcedure.test.ts` は、`deploy` が組み立てと公開の間に migration を当てる形か・本番に当たった `0001`・`0002` の中身が変わっていないか（sha256）・migration の番号が重ならないかを見張る。
2. **本番の D1 を確かめる**（読むだけ）。上の `migrations list` で、当たっているのが `0001`・`0002` だけであることを見る。本番の `0001` が今のリポジトリの `0001` と同じ中身かも確かめる（適用済みの `0001` を後から書き換えた前例がある・239db4f）。`0009` を当てる前に、本番のデモの店の数を確かめる（種データの店は6軒）:

   ```bash
   pnpm --dir web exec wrangler d1 execute ai-hack-v2 --remote --command "SELECT COUNT(*) AS demo_stores FROM accounts WHERE role = 'store' AND email LIKE '%@example.com'"
   ```

3. **Worker を止めたまま、本番の D1 へ migration を当てる**（⚠️ 本番のデータを書き換える。古いコードは新しい表の形を知らないので、Worker が動いている間に当てない）:

   ```bash
   pnpm --dir web run migrate:remote   # = wrangler d1 migrations apply ai-hack-v2 --remote
   ```

4. **運営とデモ店のパスワードを入れ替え、セッションを消す**（公開の前に。値は公開のリポジトリの履歴に残っている・安全-01）。運営は 5.3 の「乗っ取られた運営を取り返すとき」の手順で、今いる運営の一覧を流して番号を確かめ、`--account-id <番号>` の3つの文（メールの入れ替え・パスワードの入れ替え・その運営のセッションの削除）を流す。デモ店は 5.3 の「本番のデモ店のパスワードを入れ替えるとき」。新しい値は審査員へ公開されない経路で渡す。
5. **Cloudflare の管理画面で、本番の Turnstile のウィジェットの許すホスト名から `localhost` を外す**（安全-23。手元は 5.2 の試験用の鍵を使う）。
6. **事業者の表記を埋める**（2026-09-26 本人選択（AI提示）: 事業者の名称・住所は公開を再開するまで「準備中」のまま置いてある）。`web/lib/domain/texts.ts` の `OPERATOR_IDENTITY` に、事業者の名称・住所・代表者を文字列のまま書き入れる。`/privacy`（個人情報保護法の公表事項）・客向けの利用規約（`/terms`）・店向けの利用規約（`/store/terms`）の3つが同じ表記を出す。**埋めないまま流すと、次の手順の歯止め（`web/scripts/deploy-guard.mjs`）が合図があっても止める**（3つのページがこの表記を使っていることも確かめる・`web/tests/deployProcedure.test.ts`）。店向けの利用規約の文面が変わるので、版（`STORE_TERMS_VERSION`）を上げるかもこのとき決める
7. **公開の道を決めてから、合図を付けて公開する**。止めている間の設定（6.1）のままだと、公開しても workers.dev からは届かない。workers.dev で出すなら `web/wrangler.jsonc` の `workers_dev` を `true` に戻し、独自のドメインで出すなら `routes` を足す（どちらにするかは公開のときに本人の手で選ぶ）。そのうえで `ALLOW_DEPLOY=1 pnpm --dir web run deploy`。中では次の順に実行する（`web/package.json` の `deploy`）:
   0. 歯止め（`web/scripts/deploy-guard.mjs`。合図が無いとき・事業者の表記が準備中のままのときはここで止まる）
   1. OpenNext のビルド（`opennextjs-cloudflare build`）
   2. 本番の D1 に未適用の migration を当てる（`migrate:remote`＝`wrangler d1 migrations apply ai-hack-v2 --remote`。手順3で当てていれば何もしない）
   3. 公開（`wrangler deploy`）

   Worker を消して止めていた場合は、公開のあとに Worker の秘密（5.2 の（任意）でない6つ）を送る: `scripts/v2-keys.sh push`（手元を Turnstile の試験用の鍵にしているなら、5.2 の注のとおり本番の秘密鍵は別に入れる）。
8. **Google Cloud で、Geocoding API と Places API に1日の割り当て（quota）と予算アラートを置く**（安全-03。コードの側にもアプリ全体の1日の地図の上限 `MAPS_DAILY_CALL_LIMIT`（`web/lib/schemas/limits.ts`）を置いたが、割り当ては二重の備えとして残す。割り当ては、この上限より少し大きい値にする——小さいと、アプリの上限に届く前に Google が断り、客には同じ「直せなかった」が出る）。
9. **OrcaRouter の管理画面で、本番の鍵の1日の予算が、アプリ全体の1日の AI の上限（`web/lib/schemas/limits.ts` の `AI_DAILY_BUDGET_USD`）より大きいことを確かめる**（額は公開の文書に書かない・安全-25）。鍵の予算が上限より小さいと、アプリの上限に届く前に鍵が止まる。
10. **公開のあとの確かめ**:
   - Cloudflare のダッシュボードで Workers Logs（`web/wrangler.jsonc` の `observability`）が見えること。想定外の例外は `unhandled_error`、AI の1日の上限に届いた日は `ai_daily_budget_reached` の1行が残る。呼び出しごとの記録は切ってあり（`invocation_logs: false`・`redact_query_string: true`）、問い合わせ文字列つきの URL（`/api/customer/place?lat=…`・`/api/customer/place-suggest?q=…`）が1行も無いことも確かめる（要件27）
   - ブラウザの開発者ツールのコンソールで CSP の違反が出ないこと。`/login`（Turnstile が出てログインできる）・`/store/register`・`/me`・`/store`・`/admin`・運営の画面から営業許可書（PDF）を開く、の順に見る（安全-24）
   - 今いる店（デモの店を含む）の店舗情報を1回保存し直す（店の画像は保存のときに取って置き場に置く形になった。まだ置かれていない承認済みの店は、客が最初に開いたときに店の登録の URL から1日1回まで取りに行く・安全-19）
   - Cloudflare のダッシュボードの Worker の Triggers に、Cron Triggers が1本（`0 18 * * *`＝日本時間の3時）出ていること。29日を過ぎた店の位置を消した日は、Workers Logs に `store_coordinates_swept` の1行が残る（古い数えの行を消した日は `rate_counters_swept`）。落ちた日は `scheduled_failed`（2026-09-26）
   - 本番の運営の連絡先 `ADMIN_CONTACT_EMAIL` が入っていること（無いと `/privacy` とログインの画面の連絡先が「準備中」のまま出る）
   - メールアドレスの確認を動かすなら、Resend で送信元のドメインを認証し、Worker の秘密 `RESEND_API_KEY`・`MAIL_FROM` の2つを `pnpm --dir web exec wrangler secret put <名前> --name ai-hack-v2` で入れる（`scripts/v2-keys.sh push` は送らない——任意の機能なので一覧に入れていない）。入れないままなら確認の入口は 404 で、画面にも出ない
   - 止められている店の古い営業許可書の片付け（この直しより前に止めた店のファイルは置き場に残っている）は、`SELECT id, license_key, approved_license_key FROM stores WHERE status='banned'` で鍵を見て、R2 から消して列を NULL にする（本番の操作）

migration の決まり:

- **本番に当たった migration は書き換えない**（`0001`・`0002`、当てたあとの `0003` 以降も）。変えるときは新しい番号の migration を足す。`web/tests/deployProcedure.test.ts` が `0001`・`0002` の中身をハッシュで見張る
- **番号は重ねない**（同じ番号の2本は、当てる順が名前の並びに任される。同じ検査が見張る）。枝 `feat/email-verify` の `0003_email_verification.sql` は、2026-09-26 に `0015_email_verification.sql` へ付け替えて取り込んだ（`0013`・`0014` は並列の別の作業が使う）。ほかの枝を合流させるときも、本番に当たっていない側を空いている次の番号へ付け替えてから合流する
- migration を当てずにコードだけを出すと、列や制約が無いまま動いて500になる（`0002` のときに起きた）。`deploy` 以外の手で公開しない

### 6.3 ログインの締め出しを解く

ログインは次の2つで断る（要件30の基準 30.4・`web/lib/http/rateLimits.ts`）。どちらも15分待てば解ける:

- 同じアカウントへ**同じ接続元から**10回続けて失敗した → そのアカウントへのその接続元からのログインを15分断る
- **同じ接続元から**アカウントをまたいで15分に30回失敗した（パスワードスプレー） → その接続元からのログインを断る。ただし、前にその端末（ブラウザ）でそのアカウントに入ったことがあれば数えない（端末の印の Cookie `aihack_login_device`・30日）

急ぐときは、本番の数えを消す（⚠️ 本番の D1 を書き換える。メールアドレスは小文字で、IPv6 の接続元は `2001:db8:1:2::/64` のように先頭4区切りに丸めた形で書く）:

```bash
# そのアカウントの数え（どの接続元からのものも）
pnpm --dir web exec wrangler d1 execute ai-hack-v2 --remote --command "DELETE FROM rate_counters WHERE key LIKE 'login:<メールアドレス>|%'"
# 接続元ごとの数え
pnpm --dir web exec wrangler d1 execute ai-hack-v2 --remote --command "DELETE FROM rate_counters WHERE key = 'loginIp:<接続元>'"
```

## 7. 提出前の確かめ

### 7.1 自動テストが全部通る

```bash
pnpm exec vitest run
```

「expected fail」は未修正の不具合を示す検査（5.5）。件数は直しの進みで変わる。

### 7.2 10回の取得が8秒以内（基準 4.13）／`orcarouter/auto` と `orcarouter/ai-sekitori` を比べる（OrcaRouter の使い方の手順⑤）

記事に貼る数字を出す手順。**先に固定するものを固定してから回す**（途中で条件が変わると比べた数字にならない）:

1. **固定する**: 同じ場所（住所の文字）・同じ人数・同じ好み（ジャンルと予算）を決め、種データの店（公開中のオファーを持つ店を10件以上）を流し込む。取得の間、店の側の操作はしない。
2. **記録の起点を取る**: 運営の数字の画面（`/admin/metrics`）を開き、モデル別の表の件数を控える（回す前の値。あとで引く）。
3. **`orcarouter/auto` で10回**: `web/wrangler.jsonc` の `vars.ORCAROUTER_MODEL` を `orcarouter/auto` にして公開し直し、1の条件で取得を10回行う。各回の所要時間が **8秒以内**であることを見る（基準 4.13 の確かめはここで済む）。
4. **Named Router で10回**: `ORCAROUTER_MODEL` を `orcarouter/ai-sekitori` に戻して公開し直し、同じ条件で取得を10回行う。
5. **表を読む**: 運営の数字の画面のモデル別の表から、モデルごとの件数・平均実費・平均所要時間・検査落ち率・点数順になった率と、受け皿が答えた件数を控える。3と4の差が記事に貼る数字。
6. **突き合わせる**: 控えた `request_id` を1〜2件、OrcaRouter の管理画面の実費の記録と突き合わせ、記録の実費が合っていることを確かめる（記事の数字の裏取り）。
7. **戻す**: `ORCAROUTER_MODEL` を提出版の値 `orcarouter/ai-sekitori` に戻して公開し直す。

⚠️ 本番の鍵には1日の予算の上限を付けてあり、アプリの側にも1日の AI の上限がある（鍵の名前と額は公開の文書に書かない・2026-09-25 の監査の指摘 安全-25）。20回の取得がその上限に収まることを、3の途中で管理画面の実費を1回見て確かめる（超えそうなら回数を減らし、記事にはその回数を書く）。上限に届くと取得は点数順になり、比べた数字にならない。

### 7.3 実機の確かめ

- スマホの実機（iPhone・Android）で、客の画面を開いてから確保・通知の許可・店頭での完了済みまでひととおり触る。
- iPhone は**ホーム画面に追加した側だけ**プッシュが届く（Safari 単体では届かない）。ホーム画面の側は Safari と Cookie を共有せず、登録もやり直しになる。だから**今の確保は Safari で見る**のが既定で、ホーム画面への追加は確保が無いときに勧める（客の画面の案内もこの形）。追加した側で「通知を受け取る」を押すと、その場で許可の問いが出ることを確かめる。
- 機内モードにして `/me` を開き直し、端末に残した確保中の表示が出ること（Service Worker は `/me` の範囲だけに登録する）。
- 明暗の両対応（画面の設定を切り替えて色が破綻しないか）と、幅 320px の端末で確保番号が札に収まることもこのタイミングで見る。
- VoiceOver か TalkBack で、探したときに件数が、受け取ったときに確保番号が読み上げられること。

### 7.4 Turnstile の確かめ

- 手元と自動テストでは、Cloudflare が配布している「必ず通るテスト用の鍵」を使う（客の登録・店の登録・ログインの3つのフォーム）。
- ⚠️ 試験用の鍵（`1x0000000000000000000000000000000AA` など、Cloudflare が配布している公開の値）は、本番の `TURNSTILE_SECRET_KEY` に入れない。この鍵は答えを必ず通す（または必ず断る）うえ、`web/lib/adapters/turnstile.ts` は試験用の鍵のときだけ解かれた場所と用途を見ないので、入れると人の確かめが素通しになる。
- 本番の入口は、答えの `hostname` を要求のホスト名と、`action` を入口の用途（`login`・`register-store`・`register-customer`）と照らす。ふつうの利用者としてフォームを送るとき、何も押さずに通ることを確かめる。
- ブラウザの開発者ツールなどで確かめの値（トークン）を送らずにフォームを送信し、決まった断りの文が出て、AI も地図も呼ばれないことを確かめる（`TURNSTILE_SECRET_KEY` を使うサーバー側の検証が効いていることの確認）。

## 8. 外に送るデータと個人情報

どの外のサービスへ何を送るか、客の電話番号を誰に見せるか、登録の消し方は `/privacy`（`web/app/privacy/page.tsx`）にまとめてある。外のサービスを足したら、この画面の表も直す。事業者の名称・住所と、法の公表事項に当たるかどうかは運営者が確かめて書き足す（今は「準備中」と出る）。
