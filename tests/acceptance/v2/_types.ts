// 受け入れ検査が前提にする「契約」。実装はこの形に合わせる（設計書 design.md の「入口の一覧」「差し替え口」を、検査が呼べる形に固定したもの）。
// ここに無いことは検査が見ない＝実装の自由。ここに在ることは検査が呼ぶ＝変えると検査が落ちる。
//
// 1. 読み込み: 検査は `web/` のモジュールを実行時に読む（`_fakes.ts` の loadWeb）。型は any で受ける。
// 2. 入口: `web/lib/http/app.ts` の `createApp(deps)` が `{ fetch(req: Request): Promise<Response>; routes: RouteInfo[] }` を返す。
//    `app/api/**/route.ts` は同じ経路（defineRoute で組んだ手続き）を、実物の Deps で呼ぶだけ。
// 3. Deps: 下の `Deps`。`createApp` は deps を **呼ばれるたびに** 読む（作ったときに分解して閉じ込めない）。
// 4. 時刻: 手続きの中の「今」は必ず `deps.clock.now()`。SQL の比較も、束縛した「今」で行う（SQLite の datetime('now') は使わない）。
//    待ち時間（打ち切り）は `deps.clock.after(ms)` と AbortSignal の両方で書く。検査は偽の時計で after を進める。
// 5. Cookie: 客の識別子とセッションは Set-Cookie で配る。名前は自由（検査は Set-Cookie の先頭の `name=value` をそのまま返す）。
// 6. 画面の部品: data-testid の約束は末尾の TID。断りの文の出し口は `msg-<項目名>`（項目の直下）と `msg-form`（操作の直下）。

export type RouteInfo = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 例: "/api/customer/reservations/:id/cancel"（動的な区間は `:名前`） */
  path: string;
  auth: "public" | "customer" | "store" | "admin";
  /** 人かどうかの確かめ（Turnstile）つきの入口なら true */
  human: boolean;
};

export type Clock = { now(): Date; after(ms: number): Promise<void> };
export type Rng = { bytes(n: number): Uint8Array };
export type Hasher = { sha256Hex(input: string): Promise<string>; derive(password: string, saltB64: string, iterations: number): Promise<string> };
export type Logger = { log(entry: { event: string; id?: string | number; durationMs?: number; errorKind?: string }): void };

export type AiSelectInput = {
  party: number;
  genres: string[];
  budgetMax: number | null;
  stores: Array<{ id: string; genres: string[]; menus: string[]; budgetMin: number; budgetMax: number }>;
};
export type AiSelectResult =
  | { ok: true; text: string; costUsd: number | null; resolvedModel?: string | null; requestId?: string | null; fallbackLevel?: number | null }
  | { ok: false; error: string; costUsd?: number | null };
export type AiSelector = { select(input: AiSelectInput, opts: { signal?: AbortSignal }): Promise<AiSelectResult> };
/** AI の出力の本文（文字列の JSON）の形 */
export type AiSelectionText = { selections: Array<{ storeId: string; reason: string }> };

export type Geocoder = { geocode(text: string, opts: { signal?: AbortSignal }): Promise<{ ok: true; lat: number; lng: number } | { ok: false }> };
export type PushSender = { send(subscription: unknown, opts: { ttlSeconds: number }): Promise<{ ok: true } | { ok: false; gone: boolean }> };
export type CardRegistrar = {
  createSetupSession(input: { storeId: string; returnUrl: string }): Promise<{ ok: true; url: string; sessionId: string } | { ok: false }>;
  confirmSetup(sessionId: string): Promise<{ ok: true; clientReference: string } | { ok: false }>;
};
export type HumanCheck = { verify(token: string | null, opts: { signal?: AbortSignal }): Promise<{ ok: true; human: boolean } | { ok: false }> };
export type FileStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
};
export type AppConfig = { turnstileSiteKey: string; vapidPublicKey: string; contactEmail: string | null; orcarouterModel: string };

export type Deps = {
  db: any; // D1Database（wrangler の getPlatformProxy が返す束縛 DB）
  files: FileStore;
  ai: AiSelector;
  geocoder: Geocoder;
  push: PushSender;
  card: CardRegistrar;
  human: HumanCheck;
  logger: Logger;
  clock: Clock;
  rng: Rng;
  hasher: Hasher;
  config: AppConfig;
};

// ---- 応答の形（要点。細部は各検査が見る） ----
// 入力の断り（全部の入口で共通）: 400/409 `{ ok:false, error:{ kind, fields?:[{ name, reason }] } }`
// 受け取り・受け取り直しの断り: 409 `{ ok:false, refusal:{ kind, partyMax?, nextStep }, home }`
// 確保への操作（取り消し・完了済み・人数）の状態による断り: 409 `{ ok:false, current:{ state } }`
// 見分けの断り: 401（客・未ログイン）／403（役割違い）
//
// GET /api/customer/home → HomeDto
export type HomeDto = {
  kind: "fetch" | "active" | "expired" | "completed" | "store_cancelled" | "admin_cancelled";
  profile: { nickname: string; phone: string; genres: string[]; budgetMax: number | null };
  reservation?: ReservationDto;
  expired?: { showCode: boolean; canRetry: boolean; partyMax?: number };
  pushPromptDue?: boolean;
};
export type ReservationDto = {
  id: string;
  code: string;
  storeId: string;
  storeName: string;
  storeAddress: string;
  storeUrl: string | null;
  party: number;
  expiresAt: string;
  status: "active" | "completed" | "customer_cancelled" | "store_cancelled" | "admin_cancelled" | "expired";
  coupons: Array<{ name: string; note: string }>;
};
export type ResultItem = {
  offerId: string;
  storeId: string;
  storeName: string;
  walkMinutes: number;
  budgetMin: number;
  budgetMax: number;
  reason: string;
  partyMax: number;
  coupons: Array<{ name: string; note: string }>;
  storeUrl: string | null;
};
export type StoreHomeDto = {
  id: string;
  status: "pending" | "approved" | "banned";
  checklist: { license: boolean; card: boolean };
  missingProfile: string[];
  offer: null | OfferDto;
  publishPrefill: { couponIds: string[]; capacity: number | null; partyMax: number | null; until: string | null };
  coupons: Array<{ id: string; name: string; note: string }>;
  arrivals: ArrivalRow[];
};
export type OfferDto = {
  id: string;
  capacity: number;
  remaining: number;
  partyMax: number;
  untilAt: string;
  publishedAt: string;
  coupons: Array<{ id: string; name: string; note: string }>;
  /** 公開から12時間の時刻（ISO）。「何時まで」の上限として画面が使う */
  latestUntil: string;
};
export type ArrivalRow = {
  reservationId: string;
  kind: "active" | "expired" | "completed" | "store_cancelled";
  nickname: string;
  phone: string;
  party: number;
  code: string;
  expiresAt: string;
  canComplete: boolean;
  canCancel: boolean;
};

/** 画面の部品の data-testid の約束 */
export const TID = {
  field: (name: string) => `field-${name}`,
  msg: (name: string) => `msg-${name}`,
  msgForm: "msg-form",
  form: (name: string) => `form-${name}`,
  btn: (action: string) => `btn-${action}`,
  card: (offerId: string) => `result-${offerId}`,
  row: (id: string) => `row-${id}`,
  view: (kind: string) => `view-${kind}`,
  human: "human-check",
} as const;
