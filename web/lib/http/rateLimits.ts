// 連打の抑止の規則と判定（要件30【最終日】）。掛ける場所は defineRoute のただ1か所で、
// ここは「どの入口を、何で、何回まで数えるか」と「数えて断るか」だけを持つ。
//
// 入口ごとの指定（defineRoute の config）ではなく **method と path で引く表** にしてある理由:
// 抑止はどの入口にも掛かりうるので、入口の定義に書く形だと「指定を書き忘れた入口だけ守られていない」
// が起き、しかも黙って起きる（AI判断）。表にしておけば、守る入口の一覧が1か所で読める。
// 外のサービス（地図・AI・外への取得・Stripe）を呼ぶ入口が全部この表に載っていることは、構造の検査
// （rateLimits.test.ts）が入口の定義から辿って見張る（2026-09-25 監査の指摘 安全-03）。
//
// **数えは先に1回ぶんを足す**（2026-09-25 監査の指摘 安全-02）。数えは repo の1つの文で原子的に足され、
// 足したあとの回数が上限を超えていれば断る。以前の「見てから書く」形は、同時に送った要求が全部通った。
// 落ちた要求だけを数える規則（ログインなど）も、試行を先に数え、通ったら取り消す形にした。

import { ipCountingUnit } from "../domain/clientAddress";
import { isLoginDeviceValue, normalizeLoginEmail } from "../domain/loginDevice";
import type { Deps } from "../ports";
import { isKnownLoginDevice } from "../repo/loginDevices";
import { deleteRateCounter, hitRateCounter, refundRateCounter } from "../repo/rateCounters";
import {
  ACCOUNT_SECRET_FAILURE_LIMIT,
  ACCOUNT_SECRET_WINDOW_MS,
  CARD_RATE_LIMIT,
  CARD_RATE_WINDOW_MS,
  CUSTOMER_REGISTER_RATE_LIMIT,
  FETCH_RATE_LIMIT,
  FETCH_RATE_WINDOW_MS,
  LOGIN_DEVICE_TRUST_MS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_IP_FAILURE_LIMIT,
  LOGIN_LOCK_WINDOW_MS,
  PLACE_RATE_LIMIT,
  PLACE_RATE_WINDOW_MS,
  PLACE_SUGGEST_RATE_LIMIT,
  PLACE_SUGGEST_RATE_WINDOW_MS,
  RECEIVE_RATE_LIMIT,
  RECEIVE_RATE_WINDOW_MS,
  REGISTER_RATE_LIMIT,
  REGISTER_RATE_WINDOW_MS,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  STORE_IMAGE_RATE_LIMIT,
  STORE_IMAGE_RATE_WINDOW_MS,
  STORE_PROFILE_RATE_LIMIT,
  STORE_PROFILE_RATE_WINDOW_MS,
} from "../schemas/limits";

/**
 * 何で数えるか。
 * - `customer`: 客の番号（基準 30.1・30.3）
 * - `ip`: 接続元（基準 30.2。IPv6 は /64 に丸める・不具合-04）
 * - `loginEmailAndIp`: 入力のメールアドレス × 接続元（基準 30.4・安全-10 の案1）
 * - `account`: 店・運営のアカウント（セッションから・安全-03・安全-22）
 */
export type RateCountedBy = "customer" | "ip" | "loginEmailAndIp" | "account";

/**
 * 何を数えるか。どちらも手続きより前に1回ぶんを足す（断った回では手続きが動かない・基準 30.5）。
 * - `requests`: 通った要求を1つずつ。あとで取り消さない
 * - `failures`: 落ちた要求だけ。通った要求は `onSuccess` のとおり取り消す
 */
export type RateCountedWhat = "requests" | "failures";

export type RateRule = {
  /** 数の鍵の前半。同じ名前を持つ入口は**合わせて**数える（カードの開始と確かめなど） */
  name: string;
  limit: number;
  windowMs: number;
  by: RateCountedBy;
  counts: RateCountedWhat;
  /**
   * 落ちた要求だけを数える規則で、通った要求をどう取り消すか。
   * - `reset`: 数を消す＝失敗の続きが切れる（基準 30.4 の「10回続く」）
   * - `refund`: その1回ぶんだけ返す＝窓の中の失敗の数は残る（成功を挟んで数を戻す手を塞ぐ）
   */
  onSuccess?: "reset" | "refund";
  /**
   * 前にこの端末でそのアカウントに通った要求（端末の印の Cookie を持つ）では、この規則を数えない（断りもしない）。
   * ログインの接続元ごとの上限だけが使う（安全-10 のレビュー）——同じ回線の他人の失敗で、店と運営を締め出さないため。
   */
  skipForKnownLoginDevice?: boolean;
};

const FETCH_RULE: RateRule = { name: "fetch", limit: FETCH_RATE_LIMIT, windowMs: FETCH_RATE_WINDOW_MS, by: "customer", counts: "requests" };
// 客の登録と店の登録は別に数える（不具合-04 で要件30.2 の「合わせて」を変えた・AI判断）。
const CUSTOMER_REGISTER_RULE: RateRule = { name: "registerCustomer", limit: CUSTOMER_REGISTER_RATE_LIMIT, windowMs: REGISTER_RATE_WINDOW_MS, by: "ip", counts: "requests" };
const STORE_REGISTER_RULE: RateRule = { name: "registerStore", limit: REGISTER_RATE_LIMIT, windowMs: REGISTER_RATE_WINDOW_MS, by: "ip", counts: "requests" };
const REPORT_RULE: RateRule = { name: "report", limit: REPORT_RATE_LIMIT, windowMs: REPORT_RATE_WINDOW_MS, by: "customer", counts: "requests" };
const LOGIN_RULE: RateRule = { name: "login", limit: LOGIN_FAILURE_LIMIT, windowMs: LOGIN_LOCK_WINDOW_MS, by: "loginEmailAndIp", counts: "failures", onSuccess: "reset" };
// 接続元ごとの上限は正しいパスワードも断る（上限を超えても照合が通れば通す形にすると、200 と 429 で当たり外れが
// 分かり続け、スプレーの上限そのものが無くなる）。同じ回線の店と運営を巻き込まないよう、端末の印を持つ要求は数えない。
const LOGIN_IP_RULE: RateRule = {
  name: "loginIp",
  limit: LOGIN_IP_FAILURE_LIMIT,
  windowMs: LOGIN_LOCK_WINDOW_MS,
  by: "ip",
  counts: "failures",
  onSuccess: "refund",
  skipForKnownLoginDevice: true,
};
// 店の画像（2026-09-22 追加）。2026-09-25 の直し（安全-12・安全-19）で、客の要求のたびに外へ取りに行くことは
// 無くなった（保存のときに1回だけ取って置き場に置く）。置き場を読むだけになったが、数え続ける（AI判断）。
const STORE_IMAGE_RULE: RateRule = { name: "storeImage", limit: STORE_IMAGE_RATE_LIMIT, windowMs: STORE_IMAGE_RATE_WINDOW_MS, by: "customer", counts: "requests" };
// 場所の候補（2026-09-22 追加）。打つたびに呼ぶ入口で、1回ごとに地図のサービスを呼ぶ。
const PLACE_SUGGEST_RULE: RateRule = { name: "placeSuggest", limit: PLACE_SUGGEST_RATE_LIMIT, windowMs: PLACE_SUGGEST_RATE_WINDOW_MS, by: "customer", counts: "requests" };
// 現在地を地名に直す（安全-03）。1回ごとに地図のサービスを呼ぶのに、表から漏れていた。
const PLACE_RULE: RateRule = { name: "place", limit: PLACE_RATE_LIMIT, windowMs: PLACE_RATE_WINDOW_MS, by: "customer", counts: "requests" };
// 店の情報の保存（安全-03）。保存のたびに住所を地図へ問い合わせる。
const STORE_PROFILE_RULE: RateRule = { name: "storeProfile", limit: STORE_PROFILE_RATE_LIMIT, windowMs: STORE_PROFILE_RATE_WINDOW_MS, by: "account", counts: "requests" };
// カードの登録の開始と確かめ（Stripe を呼ぶ）。2つを合わせて数える。
const CARD_RULE: RateRule = { name: "card", limit: CARD_RATE_LIMIT, windowMs: CARD_RATE_WINDOW_MS, by: "account", counts: "requests" };
// 今のパスワードを確かめる操作（安全-22）。失敗だけを数え、通ったらその1回ぶんを返す。
const ACCOUNT_SECRET_RULE: RateRule = { name: "accountSecret", limit: ACCOUNT_SECRET_FAILURE_LIMIT, windowMs: ACCOUNT_SECRET_WINDOW_MS, by: "account", counts: "failures", onSuccess: "refund" };
// 受け取り・受け取り直し（安全-06 の案A）。
const RECEIVE_RULE: RateRule = { name: "receive", limit: RECEIVE_RATE_LIMIT, windowMs: RECEIVE_RATE_WINDOW_MS, by: "customer", counts: "requests" };

/** 抑止を掛ける入口の一覧（`<METHOD> <path>` → 規則。1つの入口に複数あれば全部で数える）。ここに無い入口には1度も表を引かない。 */
const RULES_BY_ROUTE: ReadonlyMap<string, readonly RateRule[]> = new Map([
  ["POST /api/customer/fetch", [FETCH_RULE]],
  // 少しずつ届ける入口（NDJSON）も同じ規則・同じ鍵（客ごと）で数える。別扱いにすると、
  // そちらから同じ回数だけ AI を呼べてしまい、抑止が黙って外れる。
  ["POST /api/customer/fetch/stream", [FETCH_RULE]],
  ["POST /api/register/customer", [CUSTOMER_REGISTER_RULE]],
  ["POST /api/register/store", [STORE_REGISTER_RULE]],
  ["POST /api/customer/reports", [REPORT_RULE]],
  ["POST /api/auth/login", [LOGIN_RULE, LOGIN_IP_RULE]],
  ["GET /api/customer/store-image", [STORE_IMAGE_RULE]],
  ["GET /api/customer/place-suggest", [PLACE_SUGGEST_RULE]],
  ["GET /api/customer/place", [PLACE_RULE]],
  ["PUT /api/store/profile", [STORE_PROFILE_RULE]],
  ["POST /api/store/card/setup", [CARD_RULE]],
  ["POST /api/store/card/confirm", [CARD_RULE]],
  ["POST /api/store/email", [ACCOUNT_SECRET_RULE]],
  ["POST /api/admin/email", [ACCOUNT_SECRET_RULE]],
  ["POST /api/admin/password", [ACCOUNT_SECRET_RULE]],
  // 店のパスワードの変更も、今のパスワードを確かめる形になれば同じ総当たりの的になる（安全-07 と揃える）。
  ["POST /api/store/password", [ACCOUNT_SECRET_RULE]],
  ["POST /api/customer/reservations", [RECEIVE_RULE]],
]);

/** その入口に掛かる規則（無ければ空）。 */
export const rateRulesFor = (method: string, path: string): readonly RateRule[] => RULES_BY_ROUTE.get(`${method} ${path}`) ?? [];

/** その入口の最初の規則（無ければ null）。検査が1つの規則を見るための近道。 */
export const rateRuleFor = (method: string, path: string): RateRule | null => rateRulesFor(method, path)[0] ?? null;

/** 抑止を掛ける入口の一覧（`<METHOD> <path>`）。表の経路が実在の入口と一致するかを検査が見張る */
export const rateLimitedRoutes = (): string[] => [...RULES_BY_ROUTE.keys()];

/** 鍵を作るのに要る材料。defineRoute が見分けと入力の検査を終えた時点の値を渡す。 */
export type RateKeySource = {
  /** Cloudflare が付ける接続元（実行者への契約: 連打の抑止は cf-connecting-ip で数える） */
  ip: string | null;
  /** 客の入口なら客の番号。それ以外の入口では null */
  customerId: string | null;
  /** 店・運営の入口ならアカウントの番号。それ以外の入口では null */
  accountId?: string | null;
  /** 検査を通った入力（ログインの入口のメールアドレスだけを見る） */
  input: unknown;
  /** 端末の印の Cookie の値（無ければ null）。`skipForKnownLoginDevice` の規則だけが見る */
  loginDevice?: string | null;
};

/** ログインの入口の入力からメールアドレスを取る。大小の違いで鍵が分かれないよう揃える（domain/loginDevice）。 */
const loginEmailOf = (input: unknown): string => {
  const value = (input as { email?: unknown } | null | undefined)?.email;
  return typeof value === "string" ? normalizeLoginEmail(value) : "";
};

/** 前にこの端末で、入力のメールアドレスのアカウントに通ったか（端末の印・安全-10 のレビュー）。 */
const fromKnownLoginDevice = async (deps: Deps, source: RateKeySource): Promise<boolean> => {
  const email = loginEmailOf(source.input);
  if (!email || !isLoginDeviceValue(source.loginDevice)) return false;
  const now = deps.clock.now();
  return isKnownLoginDevice(deps.db, {
    email,
    tokenHash: await deps.hasher.sha256Hex(source.loginDevice),
    sinceIso: new Date(now.getTime() - LOGIN_DEVICE_TRUST_MS).toISOString(),
    nowIso: now.toISOString(),
  });
};

/** 接続元の見出しが無いときの印（ログインの鍵だけが使う）。 */
const UNKNOWN_IP = "-";

const keyMaterial = (rule: RateRule, source: RateKeySource): string | null => {
  switch (rule.by) {
    case "customer":
      return source.customerId;
    case "account":
      return source.accountId ?? null;
    case "ip":
      return source.ip ? ipCountingUnit(source.ip) : null;
    case "loginEmailAndIp": {
      const email = loginEmailOf(source.input);
      // 接続元が無い要求も、メールアドレスごとには数える（同じアドレスへの試行が数から漏れないように）。
      return email ? `${email}|${source.ip ? ipCountingUnit(source.ip) : UNKNOWN_IP}` : null;
    }
  }
};

/**
 * 数の鍵。材料が無ければ null＝この要求は数えない（抑止を掛けない）。
 * 接続元の見出しが無いのは実物の Cloudflare では起きないが、無い値を1つの鍵へまとめると
 * 関係のない利用者どうしが1つの数を分け合うので、数えない側へ倒す（AI判断）。
 */
export const rateKeyFor = (rule: RateRule, source: RateKeySource): string | null => {
  const material = keyMaterial(rule, source);
  return material ? `${rule.name}:${material}` : null;
};

/** 数えた1つぶん（あとで取り消すために、どの窓で数えたかも持つ）。 */
export type RateCharge = { rule: RateRule; key: string; windowStartIso: string };

/** 数えた結果。断るなら断った印、通すなら数えた分の控え（落ちた要求だけを数える規則が、あとで取り消す）。 */
export type RateAdmission = { refused: true } | { refused: false; charges: RateCharge[] };

/**
 * その入口に掛かる規則を全部数える（手続きの前に呼ぶ）。1つでも上限を超えたら断り、
 * そのとき先に数えたほかの規則の分は返す（手続きが動いていない要求で、ほかの数えを減らさないため）。
 */
export const admitRequest = async (deps: Deps, rules: readonly RateRule[], source: RateKeySource): Promise<RateAdmission> => {
  const skipKnownDevice = rules.some((rule) => rule.skipForKnownLoginDevice) && (await fromKnownLoginDevice(deps, source));
  const applicable = skipKnownDevice ? rules.filter((rule) => !rule.skipForKnownLoginDevice) : rules;
  const keyed = applicable.flatMap((rule) => {
    const key = rateKeyFor(rule, source);
    return key ? [{ rule, key }] : [];
  });
  // 数える材料が1つも無い要求（見出しの無い接続元など）では、時計も表も触らない
  if (keyed.length === 0) return { refused: false, charges: [] };
  const nowIso = deps.clock.now().toISOString();
  const charges: RateCharge[] = [];
  for (const { rule, key } of keyed) {
    const counted = await hitRateCounter(deps.db, key, { nowIso, windowMs: rule.windowMs, limit: rule.limit });
    if (counted.count > rule.limit) {
      await Promise.all(charges.map((charge) => refundRateCounter(deps.db, charge.key, charge.windowStartIso)));
      return { refused: true };
    }
    charges.push({ rule, key, windowStartIso: counted.windowStartIso });
  }
  return { refused: false, charges };
};

/**
 * 手続きの結果で、落ちた要求だけを数える規則の分を片付ける（手続きの後に呼ぶ）。
 * 通ったら `onSuccess` のとおり取り消す。落ちたら数えたまま（先に足してある）。
 */
export const settleCharges = async (deps: Deps, charges: readonly RateCharge[], succeeded: boolean): Promise<void> => {
  if (!succeeded) return;
  for (const { rule, key, windowStartIso } of charges) {
    if (rule.counts !== "failures") continue;
    if (rule.onSuccess === "refund") await refundRateCounter(deps.db, key, windowStartIso);
    else await deleteRateCounter(deps.db, key);
  }
};
