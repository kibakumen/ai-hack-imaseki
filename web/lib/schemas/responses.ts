// 成功した応答の形のただ1つの置き場（2026-09-25 監査の指摘 設計-07・設計-09）。
//
// 入口（`<METHOD> <path>` の鍵）→ 成功の本文の形、の表 `RESPONSES` を持つ。**サーバーと画面が同じ定義を使う**:
//   - サーバー: 入口は `http/respond` の `respond(鍵, 本文)` で成功を返す。本文はこの形の型で型検査され、
//     返す前にも形を確かめる（合わなければ 500・internal と記録——形の食い違いを本番より先に検査が拾う）
//   - 画面: `client/api` の `callApi(鍵, …)` が、返ってきた本文を**必ず**この形で確かめてから返す（基準 29.4）
// それまで画面は応答の型を部品ごとに手で書き、成功の応答の形を1つも確かめていなかった（設計-07）。
//
// ⚠️ zod の**小さい版（zod/mini）から名前を指定して**読む（設計-09）。`import { z } from "zod"` は
//    約40言語の文言を名前空間ごと抱えていて組み立てで削れず、客の画面の JS の約4割を占めていた。
//    このファイルは画面の束にも入るので、`zod`（大きい版）を読んではいけない（構造の検査が見張る）。
//
// 形の決め方: **サーバーが必ず送る項目は必須**にする（2026-09-25 レビューの指摘）。任意にすると、手続きの側で
// 項目の名前がずれても、型検査（`respond` に渡すのは手続きの結果で、書き下ろした値ではないので余分な項目の
// 検査に掛からない）も実行時の形の確かめも通り、画面は undefined を読む——設計-07 が問題にした形が残る。
// 任意にするのは、場面によって載らない項目（客のホームの `reservation` など）と、古い版のサーバーが返さない
// 項目（`reservationView.origin`・`adminMetrics.byPurpose`・公開の設定）だけ。どれも理由を横に書く。
// 手続き側の正本の型（usecases・domain）とずれたら、サーバーの `respond` の型検査が落ちる。

import { array, boolean, enum as oneOf, literal, nullable, number, object, optional, record, string, union, type output, type ZodMiniType } from "zod/mini";
import type { NextStep, ReceiveRefusalKind } from "../domain/receiveRefusal";

// ---------- 共通の部品 ----------

const ok = literal(true);
/** `{ ok: true }` だけの応答（操作が通った）。 */
const done = object({ ok });

const coupon = object({ id: string(), name: string(), note: string() });
/** 店が持つクーポン1枚（repo/coupons の CouponRow）。オファーのカードに載るクーポンと違い、作った時刻も必ず載る。 */
const storeCoupon = object({ id: string(), name: string(), note: string(), createdAt: string() });
const couponFace = object({ name: string(), note: string() });

/** 公開中のオファーのカード（受け入れ検査の契約 `OfferDto`・domain/storeHome の OfferView）。 */
const offerView = object({
  id: string(),
  capacity: number(),
  remaining: number(),
  partyMax: number(),
  untilAt: string(),
  publishedAt: string(),
  coupons: array(coupon),
  latestUntil: string(),
  /** 店が「何時まで」（終了タイマー）を入れたか。false なら公開から12時間の自動の終わり（2026-09-25 店-05） */
  untilSet: boolean(),
});

const storeStatus = oneOf(["pending", "approved", "banned"]);

// ---------- 客 ----------

const customerProfile = object({ nickname: string(), phone: string(), genres: array(string()), budgetMax: nullable(number()) });

/** 確保1件（受け入れ検査の契約 `ReservationDto`・domain/customerHome の ReservationView）。 */
const reservationView = object({
  id: string(),
  code: string(),
  storeId: string(),
  storeName: string(),
  storeAddress: string(),
  storeUrl: nullable(string()),
  party: number(),
  expiresAt: string(),
  status: string(),
  coupons: array(couponFace),
  /**
   * 探したときの起点。古い応答には無いので任意。今のサーバーは打った場所の文字と place ID を返す（2026-09-26・
   * Google で直した座標は30日までしか置けない）。座標の形は、それより古い版のサーバーの応答を読むためだけに残す
   */
  origin: optional(nullable(union([object({ place: string(), placeId: optional(string()) }), object({ lat: number(), lng: number() })]))),
  /** 店が「来ない（枠を戻す）」で取り消した確保だけに載る（基準 9.14・2026-09-26 本人選択） */
  cancelReason: optional(oneOf(["no_show"])),
});

/** 客のホーム（受け入れ検査の契約 `HomeDto`・usecases/customerHome の CustomerHome）。 */
const customerHome = object({
  kind: oneOf(["fetch", "active", "expired", "completed", "store_cancelled", "admin_cancelled"]),
  /** 登録の値（usecases/customerHome が必ず載せる。登録が無ければ 401 で、ホームそのものが返らない） */
  profile: customerProfile,
  /** 以下は場面によって載らない: 確保は確保を持つ表示だけ・期限切れの中身は期限切れの表示だけ（partyMax は
   *  「何名まで」が下がっていたときだけ）・通知の説明は確保中の表示だけ（usecases/customerHome の注） */
  reservation: optional(reservationView),
  expired: optional(object({ showCode: boolean(), canRetry: boolean(), partyMax: optional(number()) })),
  pushPromptDue: optional(boolean()),
  /** 既定の幅を過ぎた完了済みの確保（取得の画面のときだけ・基準 9.4・不具合-18） */
  previousCompleted: optional(reservationView),
});

/** 取得の結果の1件（usecases/fetchOffers の FetchResultItem）。 */
const fetchResultItem = object({
  offerId: string(),
  storeId: string(),
  storeName: string(),
  walkMinutes: number(),
  budgetMin: number(),
  budgetMax: number(),
  reason: string(),
  partyMax: number(),
  coupons: array(couponFace),
  storeUrl: nullable(string()),
  storeAddress: nullable(string()),
});

const historyItem = object({
  id: string(),
  code: string(),
  status: string(),
  storeId: string(),
  storeName: string(),
  storeAddress: string(),
  storeUrl: nullable(string()),
  party: number(),
  receivedAt: string(),
});

const recentStore = object({ reservationId: string(), storeId: string(), storeName: string(), completedAt: string() });

// ---------- 店 ----------

/** 向かっている客の1行（受け入れ検査の契約 `ArrivalRow`・domain/storeHome の ArrivalView）。 */
const arrival = object({
  reservationId: string(),
  // customer_cancelled は客が取り消してから10分だけ残る行（2026-09-25 横断-08 の案A）
  kind: oneOf(["active", "expired", "completed", "store_cancelled", "customer_cancelled"]),
  // 客が決めた呼び名・登録された電話番号が無ければ null（自動の登録の仮の値を店へ渡さない・横断-02）
  nickname: nullable(string()),
  phone: nullable(string()),
  party: number(),
  code: string(),
  expiresAt: string(),
  canComplete: boolean(),
  canCancel: boolean(),
  /** 店が「来ない（枠を戻す）」で取り消した行（基準 20.16・21.8・2026-09-26 本人選択）。古い応答には無いので任意 */
  noShow: optional(boolean()),
  /** 確保が持つクーポン（客が受諾したときに見ていたもの・2026-09-26 本人発案（受諾した時点のクーポンを保障））。古い応答には無いので任意 */
  coupons: optional(array(couponFace)),
});

/** 店のホーム（受け入れ検査の契約 `StoreHomeDto`・usecases/storeHome の StoreHome）。 */
const storeHome = object({
  id: string(),
  status: storeStatus,
  checklist: object({ license: boolean(), card: boolean() }),
  missingProfile: array(string()),
  offer: nullable(offerView),
  publishPrefill: object({ couponIds: array(string()), capacity: nullable(number()), partyMax: nullable(number()), until: nullable(string()) }),
  coupons: array(storeCoupon),
  arrivals: array(arrival),
  /** 仮のパスワードで入っている（基準 14.14）。入口がセッションの印から必ず載せる */
  mustChangePassword: boolean(),
  /** 公開中のオファーの「今日の動き」——15分ごとの結果に出た回数と受け取り（公開中が無ければ空・2026-09-25 店-15） */
  trend: array(object({ at: string(), shown: number(), received: number() })),
  /** カードの登録を始めて（決済会社の画面を開いて）、まだ確かめていない。画面は開いたときに確かめを1回送る（2026-09-25 不具合-01） */
  cardSetupPending: boolean(),
  /**
   * メールアドレスを確認済みか（2026-09-26 に枝 feat/email-verify から取り込んだ）。**任意**——メールを送る口
   * （秘密 RESEND_API_KEY と MAIL_FROM）が無い公開先では、入口が項目そのものを載せない（鍵を外せば元の形に戻る）。
   * 画面は `false` のときだけ確認の帯を出す。
   */
  emailVerified: optional(boolean()),
});

const storeProfile = object({
  name: nullable(string()),
  address: nullable(string()),
  url: nullable(string()),
  genres: array(string()),
  menus: array(string()),
  budgetMin: nullable(number()),
  budgetMax: nullable(number()),
});

const storeResult = object({
  offerId: string(),
  publishedAt: string(),
  shown: number(),
  received: number(),
  completed: number(),
  cancelled: object({ total: number(), customer: number(), expired: number(), store: number(), admin: number() }),
  // そのオファーの条件と終わった理由（2026-09-25 監査の指摘 店-13・usecases/storeResults の StoreResultRow）
  capacity: number(),
  initialCapacity: number(),
  partyMax: number(),
  untilAt: string(),
  untilSet: boolean(),
  endedAt: nullable(string()),
  endReason: oneOf(["live", "stopped", "time_up", "banned"]),
  coupons: array(string()),
  couponCount: number(),
});

/** 実績の合計（今日・直近7日・店-13） */
const resultTotals = object({ offers: number(), shown: number(), received: number(), completed: number(), cancelled: number() });

// ---------- 運営 ----------

const adminStoreRow = object({
  id: string(),
  name: string(),
  address: nullable(string()),
  email: nullable(string()),
  status: storeStatus,
  publishing: boolean(),
  createdAt: string(),
  claims: number(),
  budgetMin: nullable(number()),
  offerRemaining: nullable(number()),
  // 2026-09-25 監査の指摘 運営-02・運営-05・横断-09
  changedSinceApproval: boolean(),
  contacted: boolean(),
  storeCancelled: number(),
  storeCancelRate: number(),
  /** そのうち「来ない（枠を戻す）」で取り消した数（2026-09-26 本人選択）。古い応答には無いので任意 */
  noShowCancelled: optional(number()),
  /** 店の退会の巻き添えで取り消した数（「退会でキャンセル」・上の2つに入れない・2026-09-26 本人選択）。古い応答には無いので任意 */
  withdrawnCancelled: optional(number()),
  // 店が退会した時刻（2026-09-26 本人発案の店の退会）。退会していなければ null。状況は banned のまま残るので、
  // 運営の画面はこれで「退会済み」を見分ける。この項目より前に作った画面の検査の値には無いので任意
  withdrawnAt: optional(nullable(string())),
});

const adminStoreDetail = object({
  ...adminStoreRow.shape,
  budgetMin: nullable(number()),
  url: nullable(string()),
  genres: array(string()),
  menus: array(string()),
  budgetMax: nullable(number()),
  license: boolean(),
  cardRegistered: boolean(),
  // 2026-09-25 監査の指摘 運営-02・運営-03・運営-05
  licenseUploadedAt: nullable(string()),
  approval: nullable(object({ at: nullable(string()), name: string(), address: nullable(string()), license: boolean() })),
  changes: object({ name: boolean(), address: boolean(), license: boolean() }),
  activeReservations: number(),
  duplicates: number(),
  note: nullable(string()),
  contactedAt: nullable(string()),
});

/** 運営の操作の記録の1行（2026-09-25 監査の指摘 運営-01）。`detail` は数と真偽だけ。 */
const adminAction = object({
  id: string(),
  action: oneOf(["approve", "ban", "restore", "temp_password", "view_license", "note", "acknowledge"]),
  actorEmail: nullable(string()),
  reason: nullable(string()),
  detail: record(string(), union([number(), boolean()])),
  at: string(),
});

/** 通報の1行。`reporter` は通報した客の短い印（運営-09。客の内部の番号そのものではない）。 */
const adminReport = object({ id: string(), storeId: string(), storeName: string(), reason: string(), at: string(), reporter: string(), storeReportCount: number() });

const adminMetrics = object({
  /** 数えた時点（2026-09-25 監査の指摘 運営-08。画面が「◯時◯分の時点」と出す） */
  at: string(),
  /** AI の実費の合計（全部の用途・全期間と今日＝日本時間。運営-08） */
  cost: object({ totalUsd: number(), totalCalls: number(), todayUsd: number(), todayCalls: number() }),
  /** 店の選定の AI の呼び出し（紹介文の生成と判定は byPurpose に分けて出す・不具合-10） */
  ai: object({ calls: number(), avgCostUsd: number(), avgDurationMs: number(), succeeded: number(), failed: number() }),
  /** `fellBack` は候補が在るのに点数順になった取得、`noCandidates` は候補0件で AI を呼ばなかった取得（不具合-10） */
  fetch: object({ count: number(), avgDurationMs: number(), aiUsed: number(), fellBack: number(), noCandidates: number(), fellBackRate: number() }),
  reservations: object({ total: number(), expiredRate: number() }),
  /**
   * 店が取り消した確保の数と、そのうち「来ない（枠を戻す）」で取り消した数（2026-09-26 本人選択）。`reservations` の形は
   * 受け入れ検査 r33 が固定しているので別の項目にした。古い応答には無いので任意
   */
  storeCancels: optional(object({ total: number(), noShow: number(), withdrawn: optional(number()) })),
  byModel: array(
    object({
      model: nullable(string()),
      count: number(),
      avgCostUsd: nullable(number()),
      avgDurationMs: number(),
      validationFailedRate: number(),
      fellBackRate: number(),
    }),
  ),
  /** 用途別の実費内訳（2026-09-22 に足した。古い形の応答には無いので任意） */
  byPurpose: optional(array(object({ purpose: string(), count: number(), totalCostUsd: number(), avgDurationMs: number() }))),
  fallbackCount: number(),
  /** 予備のモデルが答えた割合（全部の呼び出しのうち・設計書「運営の画面」の数字） */
  fallbackRate: number(),
});

// ---------- 入口 → 成功の本文の形 ----------

/**
 * 入口の鍵（`ROUTE_DEFINITIONS` の method と path をそのまま空白でつないだもの）→ 成功の本文の形。
 * JSON を返す入口は全部ここに載る（ファイルや少しずつ届く本文を返す入口は載らない）。
 * 載っていない入口を画面が呼ぶことはできない（`callApi` の型が止める）。
 */
export const RESPONSES = {
  // 公開の設定。画面は欠けていれば既定へ倒して読むので、どの項目も任意（client/api の getPublicConfig の注）
  "GET /api/config/public": object({ turnstileSiteKey: optional(string()), vapidPublicKey: optional(string()), contactEmail: optional(nullable(string())) }),

  // 登録・ログイン
  "POST /api/register/customer": done,
  "POST /api/register/store": object({ ok, role: literal("store") }),
  "POST /api/auth/login": object({ ok, role: oneOf(["store", "admin"]), mustChangePassword: boolean() }),
  "POST /api/auth/logout": done,
  // メールアドレスの確認のリンクを開いた（メールを送る口が無ければ 404・2026-09-26 取り込み）
  "GET /api/auth/verify-email": done,

  // 客
  "GET /api/customer/home": customerHome,
  "DELETE /api/customer": done,
  "PATCH /api/customer/profile": object({ ok, profile: customerProfile }),
  "GET /api/customer/place": object({ label: nullable(string()) }),
  "GET /api/customer/place-suggest": object({ suggestions: array(string()) }),
  "POST /api/customer/fetch": object({ ok, fetchId: string(), items: array(fetchResultItem) }),
  "POST /api/customer/reservations": object({ ok, reservation: reservationView, home: customerHome }),
  "POST /api/customer/reservations/:id/cancel": object({ ok, home: customerHome }),
  "POST /api/customer/reservations/:id/party": object({ ok, home: customerHome }),
  "GET /api/customer/history": object({ items: array(historyItem) }),
  "GET /api/customer/recent": object({ items: array(recentStore) }),
  "POST /api/customer/reports": done,
  "POST /api/customer/push-subscription": done,
  "GET /api/customer/push-message": object({ scene: nullable(string()), title: nullable(string()), body: nullable(string()) }),

  // 店
  "GET /api/store/home": storeHome,
  "GET /api/store/profile": object({ ok, profile: storeProfile }),
  "PUT /api/store/profile": object({ ok, profile: storeProfile }),
  "GET /api/store/coupons": object({ ok, items: array(storeCoupon) }),
  "POST /api/store/coupons": object({ ok, coupon: storeCoupon }),
  "PUT /api/store/coupons/:id": object({ ok, coupon: storeCoupon }),
  "DELETE /api/store/coupons/:id": done,
  "POST /api/store/offers": object({ ok, offer: offerView }),
  "POST /api/store/offers/current/stop": done,
  "POST /api/store/offers/current/add": object({ ok, offer: offerView }),
  "POST /api/store/offers/current/reduce": object({ ok, offer: offerView }),
  "POST /api/store/offers/current/party-max": object({ ok, offer: offerView }),
  "POST /api/store/offers/current/until": object({ ok, offer: offerView }),
  "POST /api/store/offers/current/coupons": object({ ok, offer: offerView }),
  "POST /api/store/reservations/:id/complete": done,
  "POST /api/store/reservations/:id/cancel": done,
  "GET /api/store/results": object({ items: array(storeResult), summary: object({ today: resultTotals, week: resultTotals }) }),
  "POST /api/store/license": done,
  // 承認の前の店が許可書を消す（2026-09-25 安全-20）
  "DELETE /api/store/license": done,
  "POST /api/store/card/setup": object({ ok, url: string() }),
  "POST /api/store/card/confirm": object({ ok, cardRegistered: literal(true) }),
  "POST /api/store/email": done,
  "POST /api/store/email/verify": done,
  "POST /api/store/password": done,
  // 店の退会（2026-09-26 本人発案）。取り消した確保の数を返す
  "POST /api/store/withdraw": object({ ok, cancelled: number() }),

  // 運営
  "GET /api/admin/stores": object({ items: array(adminStoreRow), summary: object({ publishing: number(), pending: number(), awaiting: number(), total: number() }) }),
  "GET /api/admin/stores/:id": object({
    store: adminStoreDetail,
    reports: object({ count: number(), latest: array(object({ id: string(), reason: string(), at: string(), reporter: string() })) }),
    history: array(adminAction),
  }),
  "POST /api/admin/stores/:id/approve": done,
  "POST /api/admin/stores/:id/ban": object({ ok, cancelled: number(), notified: number() }),
  // 戻した先（止めたときに許可書を消した店は承認待ち・2026-09-25 安全-20 のレビュー）
  "POST /api/admin/stores/:id/restore": object({ ok, status: oneOf(["approved", "pending"]) }),
  "POST /api/admin/stores/:id/note": done,
  "POST /api/admin/stores/:id/acknowledge": done,
  "POST /api/admin/stores/:id/temp-password": object({ ok, tempPassword: string() }),
  "GET /api/admin/reports": object({ items: array(adminReport) }),
  "GET /api/admin/metrics": adminMetrics,
  "POST /api/admin/email": done,
  "POST /api/admin/email/verify": done,
  "POST /api/admin/password": done,
} as const satisfies Record<string, ZodMiniType>;

/** 入口の鍵（`"GET /api/store/home"` の形）。 */
export type RouteKey = keyof typeof RESPONSES;

/** その入口の成功の本文の型。サーバーの `respond` と画面の `callApi` が同じ型を使う。 */
export type ResponseOf<K extends RouteKey> = output<(typeof RESPONSES)[K]>;

// ---------- 受け取りの断り（409） ----------

/**
 * 閉じた語の並びが、手続きの側の型とちょうど同じかを型検査で確かめる（足りなくても余っても型の誤り）。
 * 語の正本（domain/receiveRefusal）は値として読めない（読んでよいのは usecases/receiveOffer だけ・構造の検査）ので、
 * ここに並びを写し、型で正本につなぐ。
 */
const exactlyTheKinds =
  <T extends string>() =>
  <const L extends readonly T[]>(list: L & ([T] extends [L[number]] ? unknown : never)): L =>
    list;

const RECEIVE_REFUSAL_KIND_NAMES = exactlyTheKinds<ReceiveRefusalKind>()(["sold_out", "offer_ended", "party_over_max", "has_active_reservation", "store_banned", "results_stale", "receives_used_up"]);
const NEXT_STEP_NAMES = exactlyTheKinds<NextStep>()(["search_again", "search_again_with_party", "back_to_reservation", "retry_same_party"]);

/**
 * 受け取りの断りの本文（409・http/refusals の receiveRefused）。理由・次の一手・新しいホームを1つの応答で返す
 * （2026-09-26 のレビュー・設計-07 の残り）。成功の表と同じく、サーバーは返す前に、画面（client/api の
 * receiveRefusalOf）は使う前にこの形で確かめる。それまで型が unknown で、画面は `home` を形を見ずに描いていた。
 */
export const RECEIVE_REFUSAL = object({
  ok: literal(false),
  refusal: object({ kind: oneOf(RECEIVE_REFUSAL_KIND_NAMES), nextStep: oneOf(NEXT_STEP_NAMES), partyMax: optional(number()) }),
  home: customerHome,
});

export type ReceiveRefusalDto = output<typeof RECEIVE_REFUSAL>;

/**
 * JSON でない本文（ファイル・少しずつ届く本文）を返す入口。表に載らないことを検査が確かめる
 * （載せ忘れと、わざと載せていないものを見分けるため）。
 */
export const NON_JSON_ROUTES = ["GET /api/store/license", "GET /api/admin/stores/:id/license", "POST /api/customer/fetch/stream", "GET /api/customer/store-image"] as const;

/**
 * 少しずつ届く取得（`POST /api/customer/fetch/stream`・NDJSON）の1行の形（usecases/streamOffers の StreamLine）。
 * 画面（client/api の apiStream）は、この形に合わない行を捨てる（1行が壊れても後ろの行は届く）。
 */
export const STREAM_LINE = union([
  object({ type: literal("init"), fetchId: string(), items: array(fetchResultItem) }),
  object({ type: literal("pitch"), storeId: string(), reason: string(), source: oneOf(["persona", "fallback"]) }),
  object({ type: literal("done") }),
]);

export type StreamLineDto = output<typeof STREAM_LINE>;

/** 鍵の中の動的な区間の名前（`"/api/admin/stores/:id"` → `"id"`）。 */
export type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}` ? Name | ParamNames<`/${Rest}`> : P extends `${string}:${infer Name}` ? Name : never;

export type PathOf<K extends RouteKey> = K extends `${string} ${infer P}` ? P : never;

/** 共通の部品の型（画面が一覧の1行などを型として名乗るため）。 */
export type CustomerHomeDto = output<typeof customerHome>;
export type ReservationViewDto = output<typeof reservationView>;
export type FetchResultItemDto = output<typeof fetchResultItem>;
export type StoreHomeDto = output<typeof storeHome>;
export type OfferViewDto = output<typeof offerView>;
export type ArrivalDto = output<typeof arrival>;
export type AdminStoreRowDto = output<typeof adminStoreRow>;
export type AdminStoreDetailDto = output<typeof adminStoreDetail>;
export type AdminMetricsDto = output<typeof adminMetrics>;
export type AdminActionDto = output<typeof adminAction>;
export type AdminReportDto = output<typeof adminReport>;
