// 差し替え口の型（設計書「ファイル構成の計画」: lib/ports.ts）。手続き lib/usecases と入口
// lib/http/defineRoute はこの型だけを知って呼ぶ。実物は lib/adapters（この型を満たす）。
// 受け入れ検査の契約は tests/acceptance/v2/_types.ts（この型と同じ形に合わせてある）。

export type Clock = { now(): Date; after(ms: number): Promise<void> };
export type Rng = { bytes(n: number): Uint8Array };
export type Hasher = {
  sha256Hex(input: string): Promise<string>;
  derive(password: string, saltB64: string, iterations: number): Promise<string>;
};
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

/**
 * 人格つきの紹介文の口（店の選定 AiSelector とは**別の層**）。選定が済んだあとに、選ばれた店ごとに
 * 1本ずつ書かせる。書き手と検査官で別のモデルを使う（実物は adapters/orcarouter）。
 *
 * ⚠️ 差し替え口として**任意**にしてある（`Deps.pitch`）。無い場面では紹介文の層ごと走らせず、
 * 選定が返した決まった理由をそのまま出す——受け入れ検査の場面（この口を渡さない）で、
 * 店の選定の筋が1行も変わらないようにするため。
 */
export type PitchStore = {
  name: string;
  genres: string[];
  menus: string[];
  walkMinutes: number;
  budgetMin: number;
  budgetMax: number;
  couponName: string | null;
  couponNote: string | null;
};
export type PitchInput = {
  party: number;
  genres: string[];
  budgetMax: number | null;
  store: PitchStore;
  /** 文字数の上限（判断は domain/pitch が持つ。口はそれを指示文へ写すだけ） */
  charLimit: number;
  /** 直前の案が落ちた理由。1回目は null（2回目だけ「同じ失敗を避けて書き直す」と伝える） */
  critique: string | null;
};
export type PitchJudgeInput = { text: string; store: Pick<PitchStore, "name" | "genres" | "menus" | "couponName"> };
export type PitchResult =
  | { ok: true; text: string; costUsd: number | null; truncated: boolean; resolvedModel?: string | null; requestId?: string | null; fallbackLevel?: number | null }
  | { ok: false; error: string; costUsd?: number | null };
export type PitchWriter = {
  write(input: PitchInput, opts: { signal?: AbortSignal }): Promise<PitchResult>;
  judge(input: PitchJudgeInput, opts: { signal?: AbortSignal }): Promise<PitchResult>;
};

export type Geocoder = {
  geocode(text: string, opts: { signal?: AbortSignal }): Promise<{ ok: true; lat: number; lng: number } | { ok: false }>;
  /**
   * 位置を地名へ直す（逆方向）。客の画面が**開いた瞬間に場所の欄へ地名を入れる**ために使う
   * （2026-09-22 の本人の指摘「開いた瞬間にここに現在地の文字に変換した場所が入っていて」）。
   *
   * ⚠️ **任意**にしてある（`Deps.pitch` と同じ置き方）。この口を持たない場面では地名を出さずに
   * 座標のまま探す——受け入れ検査の偽物（`tests/acceptance/v2/_fakes.ts` の `fakeGeocoder`）は
   * この口を持たないので、**必須にすると検査の場面が落ちる**。地名は客への見せ方の飾りで、
   * 探す筋（座標で探す）には要らない。
   */
  reverse?(point: { lat: number; lng: number }, opts: { signal?: AbortSignal }): Promise<{ ok: true; label: string } | { ok: false }>;
};
/**
 * 店のホームページから雰囲気画像の URL を取る口（読むだけ・実物は adapters/storeImage）。
 * 2026-09-22 本人の指摘「お店の画像もほしい」に応えた、速成版 `sprint/lib/ogImage.ts` の移植。
 *
 * ⚠️ **任意**にしてある（`Deps.pitch`・`Geocoder.reverse` と同じ置き方）。画像は見せ方の飾りで、
 * 受け取りの筋には要らない——この口を持たない場面（受け入れ検査の偽物）でも、usecases/storeImage が
 * 外へ聞かずに `imageUrl: null` へ倒す。
 */
export type StoreImageFetcher = {
  fetch(homepageUrl: string, opts: { signal?: AbortSignal }): Promise<{ ok: true; imageUrl: string } | { ok: false }>;
};

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1Database（wrangler の getPlatformProxy／実物の Worker 束縛）。型は各アダプタ・repo が持つ
  db: any;
  files: FileStore;
  ai: AiSelector;
  /** 紹介文の層（任意）。渡さなければ紹介文を書かせない＝選定の結果だけを返す */
  pitch?: PitchWriter;
  geocoder: Geocoder;
  /** 店の雰囲気画像の口（任意。無ければ画像を出さず、飾りの地のまま） */
  storeImage?: StoreImageFetcher;
  push: PushSender;
  card: CardRegistrar;
  human: HumanCheck;
  logger: Logger;
  clock: Clock;
  rng: Rng;
  hasher: Hasher;
  config: AppConfig;
};
