---
spec: v2
phase: tasks
---

# タスク表（v2）

<!-- 書式の出典: cc-sdd（gotalab/cc-sdd・MIT License）のタスクテンプレート（_Requirements:_ の注記）を日本語にしたもの。
     ゲート（gate-doc.mjs）が検査する規則:
     - タスクは「- [ ] N. タスク名」
     - 各タスクの下に _要件: 1.1, 1.2_ ／ _受け入れ検査: tests/acceptance/<仕様>/…_ ／ _担当: AI_ か _担当: 本人_
     - AI 担当のタスクの受け入れ検査のファイルが実在する（設計者がこの段で書く）
     - requirements.md の全基準が、どれかのタスクに割り当てられている
     - ✓ は完了の記録（record.mjs done / approve.mjs が付ける）。手で付けない -->

> 2026-09-21 09:10 に設計者が書いた。入力は承認済みの `intent.md`・`requirements.md`（34要件・368基準）・`design.md`（第7周で承認）と、進行役の実装メモ（`04_v2の注文.md` の21〜26節）。
> **帰属の印**: 本人の決定を写した所には「本人発案」「本人選択」を付けた。それ以外の分け方・順・受け入れ検査の中身は設計者が置いたもので「AI判断」（後で覆されうる）。
> **並び**: 提出版（締切 2026-09-22 15:00 JST）の本体（1〜25）→ README（26）→ OrcaRouter の3点セット（27・28・落とせる）→ 【最終日】（29〜34）→ **本人の担当（35〜39・後ろにまとめた）**。本人の担当を後ろに置いたのは、本人が居ない時間に無人で回すと本人の担当で止まるため（進行役の指示）。**本人の担当のタスクは番号の順に縛られず、提出版の本体（25まで）が通った時点で、AI のタスクと並行して進めてよい**（AI判断）。
> **受け入れ検査はこの段で全部書いた**（36ファイル・`tests/acceptance/v2/`）。承認のときに指紋が取られ、以後は変えられない・足せない。各ブロックは `describeTask("<番号>", …)` でそれを実現するタスクの番号を名乗る（設計書「受け入れ検査をタスクごとに走らせる」）。

## 実装メモ

### 進行役から渡された決め（`04_v2の注文.md` 21〜26節・設計書の申し送り）

- **締切は 2026-09-22 15:00 JST**。提出版の範囲を先に、【最終日】を後ろに。
- **鍵と環境は本人が準備済み**（2026-09-21・`07_鍵と環境の準備.md` の8節-6: 秘密5つが手元 `web/.dev.vars` と Cloudflare の Worker の両方に在る。`ADMIN_CONTACT_EMAIL` だけ未・最終日でよい）。骨組みのタスク（1）はこれを前提に書く。確認の記録はタスク35（本人・済の確認）。
- **Worker・D1・R2 のバケットの名前**: `ai-hack-v2`・`ai-hack-v2`・`ai-hack-v2-permits`（22節・AI判断の既定を本人が受けた）。D1 の `database_id` は `09a71aee-5f9e-4733-b92e-275afa4cbc57`（07 の控え）。束縛の名前は `DB`・`PERMITS`（AI判断・受け入れ検査 `_fakes.ts` の `openDb` と `structure.test.ts` が見る）。
- **`web/wrangler.jsonc` の `vars` はこの3つだけ**: `ORCAROUTER_MODEL=orcarouter/ai-sekitori`・`TURNSTILE_SITE_KEY=0x4AAAAAAE98fYv_yiGU_Aa_`・`VAPID_PUBLIC_KEY=BLacCvDVdQI5_Rgb1DqHDa0m_K50tyQVp9ry6YNhaI_9nwnd77KWSmqO1Zmy5wIIecMDpSZid3sEp_AKjIeG7MI`（値は 07 の控え・本人がメモ）。秘密の名前・メールアドレスは `vars` に書かない（34.6 の走査が落とす）。
- **OrcaRouter（3点セット A-1・タスク27）**: `ORCAROUTER_MODEL` の既定は `orcarouter/auto`（コード側）。要求本文の `models` の受け皿は `anthropic/claude-haiku-4.5`（**ドット**）、候補は `openai/gpt-4o-mini`・`google/gemini-2.5-flash`。Named Router `ai-sekitori`・Guardrails `ai-sekitori`・鍵 `AIHACK` は本人が管理画面で作成済み（23節）。**A〜C は本体の後ろの独立したタスクで、間に合わなければ落とせる**（23節・本人選択）。B の2つの検査（`tools` が無い構造・`guardrail_blocked` を通る振る舞い）は本体のタスク11に入れた。
- **ゲート**: 型検査 `pnpm exec tsc --noEmit -p tsconfig.json`／lint `pnpm --dir web exec eslint .`／テスト `pnpm exec vitest run`（設計書の配列。進行役が `dev.config.json` へ写す・承認の直後・タスク1の着手前）。
- **受け入れ検査の走り方**: `tests/acceptance/v2/_tasks.ts` の `describeTask` が、着手の記録 `.dev/runs/v2/task-<番号>.json` の無いタスクのブロックを飛ばす。`_setup.ts` は fetch を「外へ出たら落とす」に差し替え、**着手済みで未完了の AI のタスクに、その番号を名乗るブロックが0件なら例外を投げる**（第7周の本人判断の受け皿・進行役の指示）。`structure.test.ts` の「最上位のブロックが全部 `describeTask`」の見張りはタスク1の番号（第7周の反論役の見落とし）。

### 実行者への契約（受け入れ検査が呼ぶ形。正本は `tests/acceptance/v2/_types.ts` の注記と各検査）

受け入れ検査は `web/` のモジュールを実行時に読み（`_fakes.ts` の `loadWeb`）、**入口は `createApp(deps).fetch(Request)`** で叩く。設計書の「入口の一覧」の URL と、次の形に合わせる（形の細部は AI判断・本人が覆せる）:

- `web/lib/http/app.ts`: `createApp(deps: Deps): { fetch(req: Request): Promise<Response>; routes: RouteInfo[] }`。`routes` は `{ method, path（動的な区間は :id）, auth: public|customer|store|admin, human: boolean }` の一覧で、**全部の入口を載せる**（横断の検査がこれを歩く）。`app/api/**/route.ts` は同じ経路を実物の Deps で呼ぶだけ（`defineRoute(` を含み、本文を自分で読まない）。
- `Deps`（`web/lib/ports.ts`）: `db`・`files`・`ai`・`geocoder`・`push`・`card`・`human`・`logger`・`clock`・`rng`・`hasher`・`config`。各差し替え口の形は `_types.ts`。**`createApp` は deps を呼ばれるたびに読む**（作った時に分解して閉じない）。`web/lib/adapters/webcrypto.ts` は `createRng()`・`createHasher()`、`adapters/logger.ts` は `createLogger()`、`adapters/orcarouter.ts` は `createOrcaRouterSelector({ apiKey, model, fetch? })`、`adapters/env.ts` は `readEnv(env)`（`config.orcarouterModel` の既定 `orcarouter/auto`）を export する。
- **時刻**: 手続きの「今」は必ず `deps.clock.now()`。**SQL の比較も束縛した「今」で行う**（SQLite の `datetime('now')` を使わない）。打ち切り（AI 6秒・地図 3秒・人かどうかの確かめ 3秒）は `deps.clock.after(ms)` と AbortSignal の両方で書く（偽の時計が `after` を進める）。「何時まで」の解釈は日本時間で固定。
- **Cookie**: 名前は自由。検査は Set-Cookie の先頭の `name=value` をそのまま返す。客の Cookie は HttpOnly・Secure・SameSite=Lax・Max-Age は7桁以上（400日）。
- **応答の形**: 入力の断りは 400/409 `{ ok:false, error:{ kind, fields?:[{ name, reason }] } }`（`schemas/error.ts` の `errorSchema`・語は `domain/inputRefusal.ts` の `INPUT_REFUSAL_KINDS`・`FIELD_REASONS`）。受け取りの断りは 409 `{ ok:false, refusal:{ kind, partyMax?, nextStep }, home }`。確保への操作の状態による断りは 409 `{ ok:false, current:{ state } }`。見分けの断りは 401（客・未ログイン）／403（役割違い・Origin）。連打の抑止【最終日】は 429 `rate_limited`。応答の要点は `_types.ts`（`HomeDto`・`ReservationDto`・`ResultItem`・`StoreHomeDto`・`OfferDto`・`ArrivalRow`）。`GET /api/admin/stores` は `?filter=publishing|approved|pending|banned&q=` と `{ items, summary:{ publishing, pending } }`。`GET /api/admin/metrics` は `{ ai:{calls,avgCostUsd,avgDurationMs,succeeded,failed}, fetch:{count,avgDurationMs,aiUsed,fellBack}, reservations:{total,expiredRate}, byModel, fallbackCount }`。
- **純粋な関数の名前**（`web/lib/domain/`）: `geo.ts` の `distanceMeters`・`walkMinutes`・`inJapan`／`filter.ts` の `filterCandidates({ origin, party, budgetMax }, stores[{ id, lat, lng, partyMax, budgetMin, budgetMax, receivable, genres }])`／`score.ts` の `scoreStore`・`rankStores(items[{ id, distanceMeters, storeGenres, createdAt }], customerGenres)`／`selection.ts` の `validateSelection(text, allowedIds)`・`fallbackResult(rankedIds)`／`offer.ts` の `isReceivable({ endedAt, untilAt, remaining }, now)`／`remaining.ts` の `remainingOf(capacity, rows[{ status, expiresAt, holdsSlot }], now)`／`until.ts` の `resolveUntil({ input, publishedAt, now }) → { kind: ok|in_past|over_window, at, latest }`／`receiveRefusal.ts` の `nextStep(kind, home)`／`storeHome.ts` の `publishPrefill({ lastOffer, coupons, now })`／`token.ts` の `tokenFromBytes`／`code.ts` の `codeFromBytes`／`password.ts` の `parsePasswordRecord`／`fileType.ts` の `detectFileType`／`genres.ts` の `GENRES`／`texts.ts` の `TEXTS`（`inputRefusal(kind, ctx)`・`fieldReason(reason, ctx)`・`receiveRefusal(kind, ctx)`・`nextStep(step, ctx)`・`push(scene) → { title, body }`・`fallbackReason`）。`schemas/customer.ts` の `customerRegisterSchema`・`schemas/fetch.ts` の `fetchSchema`。`usecases/seedAdmin.ts` の `seedAdmin(deps, { email, password })`（`web/scripts/seed-admin.mjs` もこれを呼ぶ・画面の入口は無い）。
- **テーブルの列の名前で検査が読むもの**: `customers(id, nickname, phone, genres, budget_max, token_hash)`・`accounts(email, role, store_id, password_hash)`・`stores(id, name, status, address, lat, lng, license_key, license_mime)`・`coupons(id, store_id)`・`offers(id, store_id, capacity, ended_at, end_reason, until_at)`・`reservations(id, offer_id, customer_id, status, party, code, expires_at, holds_slot, coupons_json)`・`fetch_logs(id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at)`・`fetch_items(fetch_id, store_id, rank, score, reason)`・`selections(fetch_id, store_id)`・`reservation_events(reservation_id, status)`・`ai_calls(id, fetch_id, cost_usd, duration_ms, succeeded, validation_failed, resolved_model, request_id, fallback_level, at)`・`reports(store_id, customer_id, reason, at)`・`push_subscriptions(subscription_json)`・【最終日】`rate_counters`。時刻の列は ISO 8601 の文字列。
- **AI の出力の本文**: `{"selections":[{"storeId","reason"}]}` の文字列（コードフェンスつきでも受ける）。OrcaRouter の応答は `choices[0].message.content` と `usage.cost_usd`（`sprint/lib/llm.ts` と同じ）。
- **接続元**: 連打の抑止【最終日】は `cf-connecting-ip` で数える。検査の呼び出し口は口ごとに別の IP を付ける。
- **画面の部品の約束**: `data-testid` は `_types.ts` の `TID`（項目 `field-<name>`・項目の直下の文 `msg-<name>`・操作の直下の文 `msg-form`・フォームの囲い `form-<name>`・ボタン `btn-<action>`・結果のカード `result-<offerId>`・行 `row-<id>`・客の表示 `view-<kind>`・人かどうかの確かめの部品 `human-check`〔`data-sitekey` 属性〕）。ほかに `status-banner`・`setup-checklist`（足りないものは `data-missing="true"`）・`offer-card`・`offer-remaining`・`arrivals`・`result-list`・`result-empty`・`coupon-list`・`coupon-<id>`（公開のフォームのチェック）・`genre-<ジャンル>`（チェック）・`refusal-notice`・`push-prompt`・`stale-notice`・`confirm-<action>`（確かめの囲い・中に `btn-confirm`）・`card-status`・`license-status`・`profile-saved`・`password-changed`・`report-sent`・`recent-empty`・`results-empty`・`stores-empty`・`reports-empty`・`approval-missing`・`metrics`・`by-model`・`fallback-count`・`reservation-party`。ボタンの action: `register`・`login`・`fetch`・`receive`・`cancel`・`change-party`・`retry`・`search-again`・`search-more`・`next-step`・`report`・`send-report`・`recent`・`settings`・`delete-account`・`push-allow`・`push-decline`・`save-profile`・`add-menu`・`create-coupon`・`delete-coupon`・`upload-license`・`card-setup`・`publish`・`add`・`reduce`・`party-max`・`until`・`complete`・`store-cancel`・`approve`・`ban`・`confirm`・`change-password`。部品の置き場: `components/customer/CustomerApp`（`/me` の全部）・`components/store/StoreHome`（店のホーム）・`components/store/{RegisterForm,ProfileForm,CouponEditor,DocumentsPanel,ResultsTable,PasswordForm}`・`components/auth/LoginForm`・`components/admin/{StoreList,StoreDetail,ReportList,Metrics}`・`components/customer/RefusalNotice`（props `refusal`・`onNextStep`）。部品は default か同名の named export。Turnstile の部品は `window.turnstile.render(el, { sitekey, callback })` と `reset` を使う（検査は同じ形の偽物を置く）。
- **土台（タスク1で作る）**: 直下の `package.json`（devDependencies に `vitest`・`typescript`・`wrangler`・`@testing-library/react`・`jsdom`・`react`・`react-dom`・`@types/react`・`zod` ほか）・`pnpm-workspace.yaml`（`packages: [web]`）・`vitest.config.ts`（`include` に `web/**/*.test.{ts,tsx}` と `tests/acceptance/v2/**/*.test.{ts,tsx}`、`setupFiles: ["tests/acceptance/v2/_setup.ts"]`、`environment: node`、`fileParallelism` は既定でよい）・`tsconfig.json`（`web/**` と `tests/**`、`jsx: react-jsx`、`module: ESNext`、`moduleResolution: bundler`、`strict`）。`web/.gitignore` に `.next`・`.open-next`・`.wrangler`。`web/.dev.vars.example` に6つの名前（値は空）。`web/migrations/0001_init.sql` は `;` で区切った文の並び（検査が分けて流す）。

### 前のタスクから次のタスクへ

（実行者が、タスクを終えるたびに分かったことを書き足す。設計者は空で渡す）

## タスク

### 提出版の本体（2026-09-22 15:00 まで）

- [ ] 1. 骨組み: ワークスペース・`web/` の Next.js・`wrangler.jsonc`（名前と束縛と `vars`）・テストと型検査の土台・`migrations/0001_init.sql`・`web/.gitignore`・`.dev.vars.example`
  - 設計書「ファイル構成の計画」「技術構成」「秘密情報と個人データの扱い」。テーブルは「データと状態」の全部（`ai_calls` の3列と `validation_failed`・【最終日】の列も最初から入れる・AI判断）。`pnpm install` と `pnpm exec vitest run` がこの土台だけで動く（未着手のタスクのブロックは飛ぶ）。wrangler にログイン済みなら公開してもよいが、ゲートは見ない（公開は本人の担当のタスク36）
  - _要件: 34.1, 34.5, 34.6, 31.2_
  - _受け入れ検査: tests/acceptance/v2/structure.test.ts_
  - _担当: AI_

- [ ] 2. 横断の土台: `lib/ports.ts`・`adapters/{env,webcrypto,logger}`・`lib/http/{defineRoute,cookies,guards,app}`・`schemas/{error,limits}`・`domain/{inputRefusal,texts,genres,token,code,password}`・`client/api`
  - 入力の断りの応答の形と語の一覧・決まった文の全部・見分け4種・Origin の確かめ・人かどうかの確かめの枠（差し替え口 `HumanCheck` を呼ぶ所）・ログの出口・lint の境界の設定（`no-restricted-imports`・`no-console`・`no-restricted-globals`）
  - _要件: 29.1, 29.2, 29.4_
  - _受け入れ検査: tests/acceptance/v2/d05-input-refusal.test.ts_
  - _担当: AI_

- [ ] 3. 客の登録と識別子・公開値の入口・人かどうかの確かめ: `POST /api/register/customer`・`GET /api/customer/home`（登録の有無で kind）・`GET /api/config/public`・`adapters/turnstile`・`usecases/registerCustomer`・`components/customer/{CustomerApp,RegisterForm}`・`components/ui/{InputRefusal,HumanCheck}`
  - _要件: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - _受け入れ検査: tests/acceptance/v2/r01-customer-register.test.ts_
  - _担当: AI_

- [ ] 4. 店の登録・ログイン・セッション: `POST /api/register/store`・`POST /api/auth/{login,logout}`・`sessions`・`usecases/{registerStore,login,seedAdmin}`・`web/scripts/seed-admin.mjs`・`components/store/RegisterForm`・`components/auth/LoginForm`
  - 登録の応答でセッションの Cookie も配る（AI判断・登録の直後にホームへ入れるため）
  - _要件: 12.1, 12.2, 12.3, 12.4, 12.5, 14.1, 14.2, 14.3, 14.4, 14.8, 14.9_
  - _受け入れ検査: tests/acceptance/v2/r12-store-register.test.ts_
  - _担当: AI_

- [ ] 5. 店の情報と住所の位置直し: `GET/PUT /api/store/profile`・`adapters/geocoding`・`usecases/saveStoreProfile`・`schemas/store`・`components/store/ProfileForm`
  - _要件: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12_
  - _受け入れ検査: tests/acceptance/v2/r15-store-profile.test.ts_
  - _担当: AI_

- [ ] 6. クーポン: `GET/POST /api/store/coupons`・`PUT/DELETE /api/store/coupons/:id`・`usecases/coupons`・`components/store/CouponEditor`
  - 16.5（公開中のクーポンは編集・削除できない）はオファーの表が要る。表はタスク1で在るので、`sqlFragments` の「公開中」の条件をここで書く
  - _要件: 16.1, 16.2, 16.3, 16.4, 16.5, 16.7_
  - _受け入れ検査: tests/acceptance/v2/r16-coupons.test.ts_
  - _担当: AI_

- [ ] 7. 営業許可書とカード・店のホームの帯: `GET/POST /api/store/license`・`POST /api/store/card/{setup,confirm}`・`adapters/{files,stripe}`・`domain/fileType`・`GET /api/store/home`（承認の状況・チェックリスト・`missingProfile`）・`components/store/{StoreHome,StatusBanner,SetupChecklist,DocumentsPanel}`
  - `GET /api/admin/stores/:id/license` の読み口もここ（同じ手続き `readLicense`・運営の見分けはタスク4のセッション）
  - _要件: 12.6, 12.7, 12.8, 12.9, 12.10, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.8, 13.9_
  - _受け入れ検査: tests/acceptance/v2/r13-license-card.test.ts_
  - _担当: AI_

- [ ] 8. 運営の店の一覧・詳細・承認: `GET /api/admin/stores`（絞り込み・検索・集計）・`GET /api/admin/stores/:id`・`POST …/approve`・`usecases/{adminStores,approveStore}`・`components/admin/{StoreList,StoreDetail}`
  - 停止（ban）と復帰（restore）の入口はタスク21。ただし「オファー公開中」の絞り込みと「止められている」の絞り込みの SQL はここで書く（止める操作が無くても検査は `ban` を呼ぶので、**`POST …/ban` の入口だけは、店の status を banned にして公開中のオファーを終わらせる最小の形でここに置く**。確保の取り消しとプッシュはタスク21で足す・AI判断）
  - _要件: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8, 24.9, 24.10, 24.11, 25.1, 25.2, 25.3, 25.5_
  - _受け入れ検査: tests/acceptance/v2/r24-admin-list.test.ts_
  - _担当: AI_

- [ ] 9. オファーの公開・停止・公開のフォームと公開中のカード: `POST /api/store/offers`・`POST /api/store/offers/current/stop`・`domain/{until,offer,storeHome.publishPrefill}`・`repo/{offers,sqlFragments}`・`usecases/{publishOffer,stopOffer}`・`components/store/{PublishForm,OfferPanel}`
  - 公開中のカードの4つの操作（追加・減らす・何名まで・何時まで）はタスク20。ここでは表示だけ
  - _要件: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.13, 17.14, 17.15, 17.16, 17.17, 17.18, 17.19, 17.20, 17.21, 17.22, 17.23, 18.15_
  - _受け入れ検査: tests/acceptance/v2/r17-publish.test.ts_
  - _担当: AI_

- [ ] 10. 取得の判断（純粋）: `domain/{geo,filter,score,selection}`
  - _要件: 5.1, 5.3, 5.4, 5.5, 5.6, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 7.3, 7.4, 7.5, 7.7, 7.8, 4.9, 3.6, 16.8_
  - _受け入れ検査: tests/acceptance/v2/r05-filter.test.ts_
  - _担当: AI_

- [ ] 11. 取得の手続きと AI の口: `POST /api/customer/fetch`・`usecases/fetchOffers`・`adapters/orcarouter`（呼び方は `sprint/lib/llm.ts` を書き写す・`tools` を持たない）・`repo/logs`（`fetch_logs`・`fetch_items`・`ai_calls` の insert）・`schemas/fetch`
  - 7.10（理由の文の中身・段4）は、このタスクの監査のときに監査役が公開した版の記録20件を読んで判定する（受け入れ検査には無い）
  - _要件: 3.2, 3.3, 3.4, 3.5, 3.6, 3.10, 3.11, 3.14, 3.15, 4.1, 4.2, 4.3, 4.6, 4.7, 4.8, 4.9, 4.10, 4.12, 5.2, 5.7, 6.6, 7.1, 7.2, 7.6, 7.9, 7.10, 7.11, 7.12, 27.1, 27.2, 27.5, 27.6, 28.3, 33.1, 33.2, 33.3, 34.3, 34.4_
  - _受け入れ検査: tests/acceptance/v2/r07-ai-select.test.ts_
  - _担当: AI_

- [ ] 12. 取得の画面: `components/customer/{FetchForm,ResultList}`・`client/geolocation`（現在地・5秒）
  - 受け取りのボタンの動きはタスク14。ここでは押せる形と一覧の表示まで
  - _要件: 3.1, 3.7, 3.8, 3.9, 3.12, 3.13, 4.4, 4.5, 4.11, 4.14_
  - _受け入れ検査: tests/acceptance/v2/r03-fetch-input.ui.test.tsx_
  - _担当: AI_

- [ ] 13. 受け取りと確保（手続き・判断）: `POST /api/customer/reservations`（受け取り・受け取り直し）・`usecases/receiveOffer`・`repo/reservations`（条件つきの1文の INSERT）・`domain/{code,remaining,reservation,receiveRefusal,customerHome}`・`GET /api/customer/home` の確保の表示の種類・`selections`・`reservation_events`
  - 受け取り直し（`retryOf`）の判定（期限切れから20分・受け取れる状態・何名まで）もここ。期限切れの記録（`INSERT OR IGNORE`・期限の時刻）は客のホーム・店のホームの先頭
  - _要件: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.8, 8.9, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.13, 16.6, 18.1, 18.10, 18.12, 18.13, 27.3, 27.4_
  - _受け入れ検査: tests/acceptance/v2/r08-receive.test.ts_
  - _担当: AI_

- [ ] 14. 客の画面の確保中の表示・断りの表示・取り直し: `components/customer/{ReservationView,CompletedView,StoreCancelledView,AdminCancelledView,RefusalNotice}`・`ResultList` の受け取りと断り・`client/{usePolling,reservationCache}`・`public/sw.js` の `/me` の保存
  - _要件: 8.5, 8.10, 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.13_
  - _受け入れ検査: tests/acceptance/v2/r08-receive.ui.test.tsx_
  - _担当: AI_

- [ ] 15. 客の取り消しと人数の変更: `POST /api/customer/reservations/:id/{cancel,party}`・`usecases/{cancelByCustomer,changeParty}`・`ReservationView` の2つの操作
  - _要件: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 18.2_
  - _受け入れ検査: tests/acceptance/v2/r10-cancel-party.test.ts_
  - _担当: AI_

- [ ] 16. 期限切れと受け取り直しの表示: `domain/customerHome` の期限切れ（20分・受け取り直せるか）・`components/customer/ExpiredView`（`RefusalNotice` を使う）
  - _要件: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 18.3, 18.14_
  - _受け入れ検査: tests/acceptance/v2/r11-expiry.test.ts_
  - _担当: AI_

- [ ] 17. 向かっている客と完了済み: `GET /api/store/home` の `arrivals`（`domain/storeHome` の行）・`POST /api/store/reservations/:id/complete`・`usecases/completeReservation`（期限切れの完了済みの CASE）・`components/store/ArrivalsList`
  - _要件: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.12, 20.13, 20.14, 20.15, 20.16, 20.17, 20.18, 20.19, 20.20, 20.21, 20.22, 18.7, 18.8, 18.9, 18.11_
  - _受け入れ検査: tests/acceptance/v2/r20-arrivals.test.ts_
  - _担当: AI_

- [ ] 18. 店による確保の取り消し: `POST /api/store/reservations/:id/cancel`・`usecases/cancelByStore`（プッシュの口を呼ぶ・失敗しても成立）・`ArrivalsList` の確かめ
  - プッシュの実物（`adapters/webpush`）と購読の入口はタスク19。ここでは `deps.push` を呼ぶ所まで
  - _要件: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 18.4, 18.5_
  - _受け入れ検査: tests/acceptance/v2/r21-store-cancel.test.ts_
  - _担当: AI_

- [ ] 19. Web プッシュ: `adapters/webpush`（VAPID の署名・中身を載せない・TTL 20分）・`POST /api/customer/push-subscription`・`GET /api/customer/push-message`・`usecases/pushMessage`・`components/customer/PushPrompt`・`client/push`・`public/sw.js` の受信と通知
  - _要件: 22.1, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.9, 22.10, 22.11, 22.12_
  - _受け入れ検査: tests/acceptance/v2/r22-push.test.ts_
  - _担当: AI_

- [ ] 20. 公開中の変更: `POST /api/store/offers/current/{add,reduce,party-max,until}`・`usecases/changeOffer`・`OfferPanel` の4つの操作（欄の横に公開した時刻と最長の時刻）
  - _要件: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 19.11, 19.12, 19.13_
  - _受け入れ検査: tests/acceptance/v2/r19-live-changes.test.ts_
  - _担当: AI_

- [ ] 21. 運営の停止と復帰: `POST /api/admin/stores/:id/{ban,restore}` を仕上げる（1つのトランザクションで status・オファーの終わり・確保中の確保の全部を運営に取り消された状態にし、購読のある客へプッシュ）・`usecases/{banStore,restoreStore}`・止められている店の完了済みの断り・`StoreDetail` の確かめ
  - _要件: 25.4, 25.6, 25.7, 25.8, 25.9, 25.10, 25.11, 18.6, 20.23, 20.24, 20.25, 22.2_
  - _受け入れ検査: tests/acceptance/v2/r25-approve-ban.test.ts_
  - _担当: AI_

- [ ] 22. 店の実績: `GET /api/store/results`・`usecases/storeResults`・`components/store/ResultsTable`・`app/store/results`
  - _要件: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8_
  - _受け入れ検査: tests/acceptance/v2/r23-results.test.ts_
  - _担当: AI_

- [ ] 23. 通報と最近行った店: `POST /api/customer/reports`・`GET /api/customer/recent`・`GET /api/admin/reports`・`usecases/{reportStore,recentStores,adminReports}`・`components/customer/{ReportForm,RecentStores}`・`components/admin/ReportList`
  - _要件: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7, 26.8, 26.9, 26.10, 26.11, 26.12, 26.13, 26.14, 26.15, 26.16, 26.17, 26.18, 26.19_
  - _受け入れ検査: tests/acceptance/v2/r26-report.test.ts_
  - _担当: AI_

- [ ] 24. 運営の数字の画面と記録の追加だけ: `GET /api/admin/metrics`（`byModel` は空の配列・`fallbackCount` は 0 でよい）・`usecases/adminMetrics`・`components/admin/Metrics`・`app/admin/metrics`
  - _要件: 33.4, 27.7_
  - _受け入れ検査: tests/acceptance/v2/r33-metrics.test.ts_
  - _担当: AI_

- [ ] 25. 全入口の横断検査を通す: 入力の検査（全部の入口に壊れた入力）・見える範囲（客・店・運営の入口の全部）・Origin の確かめ・ログに個人データを出さない・依存の向きと断りを描く部品の構造・秘密の走査・`app/api/**/route.ts` の揃え
  - 新しい機能は無い。ここまでのタスクで漏れた入口・応答・境界を直して、横断の検査（`r29`・`r28`・`r14` の25のブロック・`r02` の25のブロック・`d03`・`d01`・`structure.test.ts` の25のブロック）を通す
  - _要件: 29.1, 29.2, 29.3, 29.4, 28.1, 28.2, 2.4, 2.5, 14.5, 14.6, 14.7, 13.7, 13.10, 11.4, 31.1, 31.3, 27.7_
  - _受け入れ検査: tests/acceptance/v2/r29-validation.test.ts_
  - _担当: AI_

- [ ] 26. README: 手元で動かす手順（`pnpm install`・`web/.dev.vars`・`seed-admin`・`wrangler`）・公開の手順・「提出前の確かめ」（10回の取得が8秒以内・`orcarouter/auto` と `orcarouter/ai-sekitori` を10回ずつ回してモデル別の表を比べる手順・実機の確かめ・Turnstile の確かめ）
  - 手順の順は設計書「OrcaRouter の使い方」の⑤（固定する→起点を取る→auto で10回→Named Router で10回→表を読む→突き合わせる→戻す）
  - _要件: 34.7_
  - _受け入れ検査: tests/acceptance/v2/structure.test.ts_
  - _担当: AI_

### OrcaRouter の3点セット（本人選択・23節。本体の後ろ・間に合わなければ落とせる）

- [ ] 27. A-1 受け皿と応答ヘッダーの3列: `adapters/orcarouter` に `models`（受け皿は `anthropic/claude-haiku-4.5`）と `route: "fallback"`、`ORCAROUTER_MODEL` の読み取り、応答ヘッダー `X-Orca-Resolved-Model`・`X-Orca-Request-Id`・`X-Orca-Fallback-Level` を `ai_calls` の3列へ（無ければ NULL）
  - _要件: 33.1, 7.6, 34.4_
  - _受け入れ検査: tests/acceptance/v2/r33-metrics.test.ts_
  - _担当: AI_

- [ ] 28. A-2 モデル別の表: `usecases/adminMetrics` の `byModel`（`resolved_model` ごとの件数・平均実費・平均所要時間・検査落ち率・倒れた率・NULL は「不明」）と `fallbackCount`・`components/admin/Metrics` の表
  - _要件: 33.4_
  - _受け入れ検査: tests/acceptance/v2/r24-admin.ui.test.tsx_
  - _担当: AI_

### 【最終日】（9/23 の会場まで）

- [ ] 29. 客の登録の変更: `PATCH /api/customer/profile`・`usecases/updateCustomerProfile`・`components/customer/ProfileSettings`
  - _要件: 1.9_
  - _受け入れ検査: tests/acceptance/v2/r01-customer-register.test.ts_
  - _担当: AI_

- [ ] 30. 過去の受け取りの見返し: `GET /api/customer/history`・`usecases/customerHistory`・`components/customer/History`
  - _要件: 8.11_
  - _受け入れ検査: tests/acceptance/v2/r08-receive.test.ts_
  - _担当: AI_

- [ ] 31. 仮のパスワード・パスワードの変更・運営の連絡先: `POST /api/admin/stores/:id/temp-password`・`POST /api/store/password`・`accounts.must_change_password`・`ADMIN_CONTACT_EMAIL` を `GET /api/config/public` の `contactEmail` で・`components/store/PasswordForm`・`LoginForm` の連絡先・`app/store/password`
  - _要件: 14.10, 14.11, 14.12, 14.13, 14.14, 14.15, 14.16, 14.17_
  - _受け入れ検査: tests/acceptance/v2/r14-login-scope.test.ts_
  - _担当: AI_

- [ ] 32. 登録の消去: `DELETE /api/customer`・`usecases/deleteCustomer`（確保中・期限から20分以内の期限切れがあると断る）・`client/reservationCache` の消去・`CustomerApp` の設定の画面
  - _要件: 28.4, 28.5, 28.6, 28.7, 28.8, 28.9, 28.10, 28.11_
  - _受け入れ検査: tests/acceptance/v2/r28-personal-data.test.ts_
  - _担当: AI_

- [ ] 33. 連打の抑止: `rate_counters`・`defineRoute` の抑止（取得 1分5回・登録 1時間10回〔`cf-connecting-ip`〕・通報 1時間5回・ログインの失敗10回で15分）・断った取得で AI も地図も呼ばない・画面の `rate_limited` の文
  - _要件: 30.1, 30.2, 30.3, 30.4, 30.5_
  - _受け入れ検査: tests/acceptance/v2/r30-rate-limit.test.ts_
  - _担当: AI_

- [ ] 34. 明暗の両対応: `app/globals.css` の色の変数に暗い設定の値を足す（部品は変数でだけ色を指す）
  - 見た目の確かめは本人（タスク39）
  - _要件: 32.3_
  - _受け入れ検査: tests/acceptance/v2/structure.test.ts_
  - _担当: AI_

### 本人の担当（後ろにまとめた。番号の順に縛られない）

- [ ] 35. 鍵と環境の準備が済んでいることの確認（済の確認）: `scripts/v2-keys.sh check` で秘密5つが手元と Cloudflare の両方に在ること・D1 `ai-hack-v2`・R2 `ai-hack-v2-permits`・Workers の有料プラン・Turnstile のサイトキーと VAPID の公開の側のメモが `web/wrangler.jsonc` の `vars` と一致すること
  - 2026-09-21 に本人が確認済み（`07_鍵と環境の準備.md` 8節-6・控えの表）。ここは記録のためのタスクで、AI のタスクはこれを待たない
  - _要件: 34.2_
  - _受け入れ検査: なし_
  - _担当: 本人_

- [ ] 36. 公開と段3の確かめ: `pnpm --dir web run deploy`（OpenNext・進行役が手を貸してよい）で公開し、URL が応答する／README の「提出前の確かめ」を歩く——10回の取得が8秒以内（`orcarouter/auto` と `orcarouter/ai-sekitori` で10回ずつ・記事の数字を控える・A-4）／テスト用のカードで登録が最後まで終わる／Android と iPhone（ホーム画面に追加）の実機に2つの場面のプッシュが届く／実物の Turnstile が人を止めない
  - 予算上限は鍵 `AIHACK` の $1/日。20回の取得の途中で管理画面の実費を1回見る
  - _要件: 34.2, 4.13, 13.11, 22.13_
  - _受け入れ検査: なし_
  - _担当: 本人_

- [ ] 37. 段5の確かめ: 幅 375px のスマホで客と店の画面を一通り（取得・受け取り・店頭での完了済みまで）触り、横スクロールとアプリの導入の求めが無い／運営の画面は PC で／機内モードで `/me` を開き直しても同じ表示／チームD の他のメンバーが README だけで手元で動かせる
  - _要件: 32.1, 32.2, 32.4, 9.12, 34.7_
  - _受け入れ検査: なし_
  - _担当: 本人_

- [ ] 38. GitHub の public リポジトリ: 提出用の写し（`git clone --no-local`）で履歴から `sprint/` を消し（`git filter-repo --path sprint/ --invert-paths`）、`git log --all --oneline -- sprint/` が0行と古い鍵が履歴に無いことを確かめてから、public のリポジトリを作って push する（手順は `07_鍵と環境の準備.md` 9節）。公開中の速成版 `ai-hack-sekiari` が古い鍵で動いているなら、先に鍵を入れ替える
  - 履歴から `sprint/` を消して push することは本人選択（19節）。手元の作業用のリポジトリは書き換えない（設計者の案・AI判断）
  - _要件: 34.8_
  - _受け入れ検査: なし_
  - _担当: 本人_

- [ ] 39. 【最終日】明暗の確かめ: OS の明るい設定と暗い設定の両方で文字が読めることを見る
  - _要件: 32.3_
  - _受け入れ検査: なし_
  - _担当: 本人_
