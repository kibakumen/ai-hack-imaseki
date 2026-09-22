# ダミーデータの作り方（イマセキ）

データベースは **Cloudflare D1**（SQLite）。テーブルの定義の正本は `web/migrations/`、
値の範囲の正本は `web/lib/schemas/limits.ts`、ジャンルの正本は `web/lib/domain/genres.ts` です。

⚠️ **手で `INSERT` を書く前に、下の「先に読んでほしい落とし穴」を見てください。**
スキーマだけ見て素直に書くと、**黙って0行挿入になる**箇所が2つあります。

---

## 1. いちばん速い道：既存のスクリプトを写す

`web/scripts/seed-demo.mjs` が、運営1件・店6軒・オファー・クーポンを一式入れます。
**店の配列を差し替えるだけ**で好きなデータを作れます。

```bash
# 手元の D1 へ入れる
pnpm --dir web exec wrangler d1 migrations apply ai-hack-v2 --local
node web/scripts/seed-demo.mjs \
  --admin-email admin@example.com --admin-password '<16字以上>' \
  --store-password '<16字以上>'

# 本番用の SQL を出す（実行はしない）
node web/scripts/seed-demo.mjs --admin-email … --admin-password … --store-password … --print
```

この形にしてあるのは、**本番の D1 を確かめの無いスクリプトから黙って書き換えないため**です。
`--print` が出した SQL を読んでから流してください。再実行しても安全です
（同じメールアドレスの店は作り直さず、既にあるクーポン・公開中のオファーは二重に作りません）。

**パスワードのハッシュを自分で作らないでください。** スクリプトは `lib/usecases/seedAdmin.ts` と
`lib/adapters/webcrypto.ts` を通します（PBKDF2-SHA256 を10万回・塩と回数を一緒に保存）。

---

## 2. 先に読んでほしい落とし穴（4つ）

### ① 店は「承認済み」にしないと客の検索に出ない

`stores.status` は `pending` / `approved` / `banned` の3つで、**既定は `pending`**。
客の検索に出るのは `approved` だけです。

⚠️ **承認の手続き（`usecases` の `approveStore`）は、営業許可書とカードの両方が無いと通りません。**
ダミーでそこまで用意したくないときは、1つ下の層（`repo/adminStores.ts` の生の SQL）を直に呼んでください
——そちらは `WHERE status='pending'` しか見ません。

### ② オファーの挿入は「条件つきの1文」で、条件が外れると0行になる

`repo/offers.ts` の `insertOfferIfNone` は、**「店が承認済み」「公開中のオファーが無い」を
SQL の `WHERE` の中で原子的に確かめます**。承認より先に呼ぶと**エラーにならず0行挿入**です。
順序は必ず **店を作る → 承認する → オファーを公開する**。

### ③ 住所から座標は外部サービスを呼ぶ。ダミーでは座標を直に入れる

`usecases` の `saveStoreProfile` は住所を Google Geocoding に投げて緯度経度を確定します。
ダミーで座標を指定したいなら、1つ下の `repo/stores.ts` の `updateStoreProfile` を直に呼んでください。
その場合、**住所と座標の辻褄はあなたの責任**になります。

### ④ 会場から徒歩10分（800m）に入れないと1件も出ない

客の検索は**起点から 800m** で足切りします（`lib/domain/geo.ts`・徒歩は 80m/分で換算）。
今のデモは会場（御茶ノ水ソラシティ **35.6984924, 139.7668622**）から 144〜785m に6軒置いてあります。
**別の街のデータを作るときは、起点をどこにするか先に決めてください。**

---

## 3. テーブルの形（ダミーを作るときに触るもの）

`id` はどれも文字列です。既存は16バイトの乱数を base64url にした22字ですが、
**ダミーなら読みやすい文字列で構いません**（`store-1` など）。

### stores — 店

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | TEXT | 主キー |
| `name` | TEXT | 必須。1〜50字 |
| `created_at` | TEXT | **必須**。ISO8601。⚠️ **同点・同距離のときの並び順に使われる**ので、ばらけさせてください |
| `status` | TEXT | `pending` / `approved` / `banned`。既定 `pending` |
| `address` | TEXT | 200字まで |
| `lat` / `lng` | REAL | 緯度経度 |
| `url` | TEXT | 店のホームページ。`http`/`https` のみ。**空でよい** |
| `genres` | TEXT | **JSON の配列の文字列**。`["ラーメン"]` のように。1〜3個 |
| `menus` | TEXT | **JSON の配列の文字列**。1件1〜40字・最大5件 |
| `budget_min` / `budget_max` | INTEGER | 1人あたりの円。0〜100,000 |
| `license_key` / `license_mime` | TEXT | 営業許可書（R2 の鍵）。ダミーは NULL でよい |
| `card_registered_at` ほか | TEXT | カード登録。ダミーは NULL でよい |

⚠️ **`url` にダミーを入れるときの注意**: 客のカードは、この URL の `og:image` を読んで店の写真を出します。
**架空の店に実在する飲食店のサイトを結びつけないでください**——その店の写真を偽の掲載に使うことになります。
今のデモは全店 NULL にしてあります。

**ジャンルは次の12個からだけ選んでください**（`lib/domain/genres.ts` が正本。ここに無い文字列は弾かれます）:

```
和食 / 寿司・海鮮 / 焼肉 / 焼き鳥・串 / 居酒屋 / ラーメン
そば・うどん / 中華 / イタリアン・洋食 / カレー・エスニック / 韓国料理 / カフェ・バー
```

### accounts — 店と運営のログイン

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | TEXT | 主キー |
| `email` | TEXT | **必須・大小を区別せず一意**（`COLLATE NOCASE UNIQUE`） |
| `password_hash` | TEXT | **自分で作らない**。スクリプト経由で |
| `role` | TEXT | `store` か `admin` のどちらか |
| `store_id` | TEXT | 店のときだけ。運営は NULL |
| `must_change_password` | INTEGER | 仮パスワードで入った印。ダミーは 0 |
| `failed_count` / `locked_until` | | ログイン失敗の数え。ダミーは 0 / NULL |

### offers — 公開中のオファー（店ごとに1つまで）

| 列 | 型 | 備考 |
| --- | --- | --- |
| `store_id` | TEXT | |
| `capacity` | INTEGER | **残りの組数**。1〜20 |
| `initial_capacity` | INTEGER | 公開したときの組数（実績の計算に使う） |
| `party_max` | INTEGER | 1組の上限人数。1〜10 |
| `published_at` / `until_at` | TEXT | ISO8601。**`until_at` が過ぎると検索に出ません** |
| `coupon_ids` | TEXT | **JSON の配列の文字列**。最大3件 |
| `ended_at` / `end_reason` | TEXT | 公開中は NULL |

⚠️ **残り枠は列に持っていません。** `capacity` から使用中の確保を引いた**式**で毎回出します。
ダミーで「残り2組」にしたいなら、`capacity` と確保の行の辻褄を合わせてください。

### coupons — クーポン（1店3枚まで）

`store_id` / `name`（1〜40字）/ `note`（0〜100字・**空文字でよい。NULL 不可**）/ `created_at`。

### customers — 客

| 列 | 備考 |
| --- | --- |
| `nickname` / `phone` | 自動登録は `guest-xxxxxx` と仮の番号 `0000000000` を入れます |
| `genres` | **JSON の配列の文字列**。既定 `[]` |
| `budget_max` | INTEGER。無指定は NULL |
| `token_hash` | **Cookie に配る値の SHA-256 の16進**。生の値は保存しません |
| `deleted_at` | 退会の印 |

**ダミーの客を作ってブラウザ無しで API を叩きたいとき**はこうします:

```bash
TOKEN="dummy-$(openssl rand -hex 12)"
HASH=$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hex | sed 's/.*= //')
# customers に token_hash=$HASH の行を入れてから、
curl -b "aihack_customer=$TOKEN" https://<公開先>/api/customer/home
```

### reservations — 確保

`code` は**8桁の数字・全体で一意**。`status` は5つ:
`active` / `completed` / `customer_cancelled` / `store_cancelled` / `admin_cancelled`。
`expires_at` は受け取りから20分。`coupons_json` は**受け取った時点のクーポンの写し**（後から店が変えても動きません）。

### 記録用の5つ（`fetch_logs` / `fetch_items` / `selections` / `reservation_events` / `ai_calls`）

**ダミーで作る必要はありません。** アプリが動くと自動で溜まります。

⚠️ この5つには**個人データの列が1つもありません**（呼び名・電話番号・メールアドレスは型として存在しない）。
**ダミーでも入れないでください。** 構造の検査がこの表への `UPDATE` と `DELETE` を禁じています。

---

## 4. 入れたあとの確かめ方

```bash
# 件数
pnpm --dir web exec wrangler d1 execute ai-hack-v2 --local \
  --command "SELECT (SELECT COUNT(*) FROM stores WHERE status='approved') AS 承認済み, (SELECT COUNT(*) FROM offers WHERE ended_at IS NULL) AS 公開中"

# 起点から実際に出るか（客の Cookie を用意してから）
curl -b "aihack_customer=<生の値>" -H 'content-type: application/json' \
  -X POST -d '{"lat":35.6984924,"lng":139.7668622,"party":2,"genres":[],"budgetMax":null}' \
  https://<公開先>/api/customer/fetch
```

**0件になったら、疑う順番はこれです**: ①店が `approved` か ②オファーの `ended_at` が NULL か
③`until_at` が未来か ④起点から 800m 以内か ⑤`party_max` が人数以上か ⑥予算の幅が客の上限に収まるか。
