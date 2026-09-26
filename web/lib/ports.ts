// 差し替え口の型（設計書「ファイル構成の計画」: lib/ports.ts）。手続き lib/usecases と入口
// lib/http/defineRoute はこの型だけを知って呼ぶ。実物は lib/adapters（この型を満たす）。
// 受け入れ検査の契約は tests/acceptance/v2/_types.ts（この型と同じ形に合わせてある）。

import type { D1Database } from "./repo/d1";

export type Clock = { now(): Date; after(ms: number): Promise<void> };
export type Rng = { bytes(n: number): Uint8Array };
export type Hasher = {
  sha256Hex(input: string): Promise<string>;
  derive(password: string, saltB64: string, iterations: number): Promise<string>;
};
/**
 * 記録の1行。`actor` は操作した店・運営のアカウントの内部の番号（運営の強い操作で「誰が」を残す・
 * 2026-09-25 監査の指摘 運営-01）。どれも自由な文字列ではない（個人データを載せない）。
 */
/** 記録の1行。`count` は件数だけを残す手入れの記録（例: 30日を過ぎて消した店の座標の数・2026-09-26）。 */
export type Logger = { log(entry: { event: string; id?: string | number; actor?: string; durationMs?: number; errorKind?: string; count?: number }): void };

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
 * 選定が返した決まった理由をそのまま出す——紹介文の層を外しても、店の選定の筋が1行も変わらないようにするため。
 * 受け入れ検査の偽物もこの口を持つ（既定は `fakePitch()`。口が無い形は `pitch: undefined` を渡して作る。
 * 2026-09-25 設計-03 で偽物に口を足したので、「受け入れ検査はこの口を渡さない」と書いていた注を直した）。
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
  /**
   * 住所・場所の文字を位置へ直す。直せなかったときの `notFound: true` は「住所が位置に直らないと Google が答えた」
   * （0件）で、打ち切り・通信の失敗・上限・鍵の拒否では付けない（2026-09-25 設計-20 のレビュー: 30日の手入れが、
   * 外の一時的な障害と住所のせいを分けて扱うため）。付けない実物・偽物は、どちらか分からないものとして扱われる。
   * 当たったときの `placeId` は Google の場所の番号（応答の最初の1件の place_id・無ければ付けない）。取得の記録は
   * 座標の代わりにこれを残す（Service Specific Terms 6.3.1 は座標を30日までに限り、place ID は無期限・2026-09-26）。
   */
  geocode(text: string, opts: { signal?: AbortSignal }): Promise<{ ok: true; lat: number; lng: number; placeId?: string } | { ok: false; notFound?: boolean }>;
  /**
   * 位置を地名へ直す（逆方向）。客の画面が**開いた瞬間に場所の欄へ地名を入れる**ために使う
   * （2026-09-22 の本人の指摘「開いた瞬間にここに現在地の文字に変換した場所が入っていて」）。
   *
   * ⚠️ **任意**にしてある（`Deps.pitch` と同じ置き方）。この口を持たない場面では地名を出さずに
   * 座標のまま探す——地名は客への見せ方の飾りで、探す筋（座標で探す）には要らない。
   * 受け入れ検査の偽物（`tests/acceptance/v2/_fakePorts.ts` の `fakeGeocoder`）もこの口を持つ。口が無い形は
   * `fakeGeocoder({ reverse: false })` で作る（2026-09-25 設計-03 で偽物に口を足したので注を直した）。
   */
  reverse?(point: { lat: number; lng: number }, opts: { signal?: AbortSignal }): Promise<{ ok: true; label: string } | { ok: false }>;
  /**
   * 打ちかけの文字から場所の候補を出す（入口 GET /api/customer/place-suggest・2026-09-22 の本人の指摘
   * 「場所入力欄に渋谷駅などを打っても候補がでません」）。
   *
   * ⚠️ **任意**にしてある（`reverse` と同じ置き方）。この口を持たない場面では候補を出さずに空を返す
   * ——候補は入力の補助で、探す筋（文字か座標で探す）には要らない。受け入れ検査の偽物もこの口を持ち、
   * 口が無い形は `fakeGeocoder({ suggest: false })` で作る（2026-09-25 設計-03）。
   * `source` はどの経路で取れたか（実物は Places → Geocoding の2段構え）。**記録にだけ残し、客には見せない。**
   */
  suggest?(text: string, opts: { signal?: AbortSignal }): Promise<{ ok: true; suggestions: string[]; source: "places" | "geocoding" } | { ok: false }>;
};
/** 取った店の画像（種類は先頭のバイトで決めた値・domain/imageType）。 */
export type StoreImageFile = { body: Uint8Array; contentType: string };

/**
 * 店のホームページの og:image / twitter:image を1枚、**画像のバイトまで**取る口（実物は adapters/storeImage）。
 * 2026-09-22 本人の指摘「お店の画像もほしい」に応えた、速成版 `sprint/lib/ogImage.ts` の移植。
 *
 * 2026-09-25 監査の指摘 安全-12・安全-19 で、URL を返して客の端末に店のサーバーから直接読ませる形をやめ、
 * **店が情報を保存したときに1回だけ取り、置き場に置いて自分のオリジンから配る**形にした（usecases/storeImage）。
 *
 * ⚠️ **任意**にしてある（`Deps.pitch`・`Geocoder.reverse` と同じ置き方）。画像は見せ方の飾りで、
 * 受け取りの筋には要らない——この口を持たない場面では、外へ聞かずに画像なしのまま進む。
 */
export type StoreImageFetcher = {
  fetch(homepageUrl: string, opts: { signal?: AbortSignal }): Promise<{ ok: true; image: StoreImageFile } | { ok: false }>;
};

/**
 * Web プッシュの送信。`signal` は打ち切りの合図（任意）——応答しない配信先で呼ぶ側の応答が止まらないよう、
 * 呼ぶ側（usecases/pushMessage）が数秒で鳴らす（2026-09-25 監査の指摘 不具合-08）。
 */
export type PushSender = { send(subscription: unknown, opts: { ttlSeconds: number; signal?: AbortSignal }): Promise<{ ok: true } | { ok: false; gone: boolean }> };
/**
 * カードの登録の口。`confirmSetup` の `expired` は、決済会社のセッションの期限が切れてもう完了しないこと
 * （呼ぶ側が控えを消す・2026-09-25 カード登録の自動の確かめのレビュー）。入力の途中・問い合わせの失敗では付けない。
 */
export type CardRegistrar = {
  createSetupSession(input: { storeId: string; returnUrl: string }): Promise<{ ok: true; url: string; sessionId: string } | { ok: false }>;
  confirmSetup(sessionId: string): Promise<{ ok: true; clientReference: string } | { ok: false; expired?: boolean }>;
};
/**
 * 人かどうかの確かめ（Turnstile）。`expectedHostname` と `expectedAction` を渡すと、答えの解かれた場所と
 * 用途がそれに合わない値を人と認めない（2026-09-25 監査の指摘 安全-23）。`remoteIp` は利用者の接続元。
 */
export type HumanCheckOptions = { signal?: AbortSignal; expectedHostname?: string; expectedAction?: string; remoteIp?: string | null };
export type HumanCheck = { verify(token: string | null, opts: HumanCheckOptions): Promise<{ ok: true; human: boolean } | { ok: false }> };
export type FileStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /**
   * その前置きで始まる鍵の一覧（任意の口）。どの店の行からも指されていない営業許可書を消す掃除（usecases/licenseSweep・
   * 2026-09-25 安全-20 のレビュー）だけが使う。持たない口では掃除を走らせない。
   */
  list?(prefix: string): Promise<string[]>;
};
export type AppConfig = { turnstileSiteKey: string; vapidPublicKey: string; contactEmail: string | null; orcarouterModel: string };

export type Deps = {
  /** D1（wrangler の getPlatformProxy／実物の Worker 束縛）。型は使う分だけを repo/d1.ts が持つ（設計-14） */
  db: D1Database;
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
  /**
   * 応答を返したあとも走らせたい仕事を預ける口（任意・2026-09-25 監査の指摘 設計-17）。本物は Worker の
   * `ctx.waitUntil`（adapters/env が渡す）。預けないと、応答を閉じた時点で Worker が残りの仕事を切る——
   * 紹介文の AI の呼び出しとその記録（ai_calls）が、本番だけ跡を残さずに欠ける（手元の workerd で実測）。
   * 無い場面（受け入れ検査・単体の検査）では預けずにそのまま走らせる（Node は応答のあとも仕事を切らない）。
   */
  defer?: (task: Promise<unknown>) => void;
};
