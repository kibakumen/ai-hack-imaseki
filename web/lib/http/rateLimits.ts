// 連打の抑止の規則と判定（要件30【最終日】）。掛ける場所は defineRoute のただ1か所で、
// ここは「どの入口を、何で、何回まで数えるか」と「窓の中かどうか」だけを持つ。
//
// 入口ごとの指定（defineRoute の config）ではなく **method と path で引く表** にしてある理由:
// 抑止はどの入口にも掛かりうるので、入口の定義に書く形だと「指定を書き忘れた入口だけ守られていない」
// が起き、しかも黙って起きる（AI判断）。表にしておけば、守る入口の一覧が1か所で読める。
// ⚠️ 取得（POST /api/customer/fetch）と通報（POST /api/customer/reports）は別のタスクが作る入口で、
// 経路が出来た時点でこの表から自動で抑止が掛かる（表の鍵が経路そのものなので、向こうの実装は要らない）。

import type { Deps } from "../ports";
import { deleteRateCounter, findRateCounter, saveRateCounter, type RateCounterRow } from "../repo/rateCounters";
import {
  FETCH_RATE_LIMIT,
  FETCH_RATE_WINDOW_MS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_LOCK_WINDOW_MS,
  REGISTER_RATE_LIMIT,
  REGISTER_RATE_WINDOW_MS,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
} from "../schemas/limits";

/** 何で数えるか。客の番号（基準 30.1・30.3）・接続元（基準 30.2）・入力のメールアドレス（基準 30.4）。 */
export type RateCountedBy = "customer" | "ip" | "loginEmail";

/**
 * 何を数えるか。
 * - `requests`: 通った要求を1つずつ。手続きより手前で足すので、断った回では手続きが動かない（基準 30.5）
 * - `failures`: 落ちた要求だけ。通ったら数を消す＝「失敗が続く」を数える（基準 30.4）
 */
export type RateCountedWhat = "requests" | "failures";

export type RateRule = {
  /** 数の鍵の前半。同じ名前を持つ入口は**合わせて**数える（客の登録と店の登録・基準 30.2） */
  name: string;
  limit: number;
  windowMs: number;
  by: RateCountedBy;
  counts: RateCountedWhat;
};

const FETCH_RULE: RateRule = { name: "fetch", limit: FETCH_RATE_LIMIT, windowMs: FETCH_RATE_WINDOW_MS, by: "customer", counts: "requests" };
const REGISTER_RULE: RateRule = { name: "register", limit: REGISTER_RATE_LIMIT, windowMs: REGISTER_RATE_WINDOW_MS, by: "ip", counts: "requests" };
const REPORT_RULE: RateRule = { name: "report", limit: REPORT_RATE_LIMIT, windowMs: REPORT_RATE_WINDOW_MS, by: "customer", counts: "requests" };
const LOGIN_RULE: RateRule = { name: "login", limit: LOGIN_FAILURE_LIMIT, windowMs: LOGIN_LOCK_WINDOW_MS, by: "loginEmail", counts: "failures" };

/** 抑止を掛ける入口の一覧（`<METHOD> <path>` → 規則）。ここに無い入口には1度も表を引かない。 */
const RULES_BY_ROUTE: ReadonlyMap<string, RateRule> = new Map([
  ["POST /api/customer/fetch", FETCH_RULE],
  // 少しずつ届ける入口（NDJSON）も同じ規則・同じ鍵（客ごと）で数える。別扱いにすると、
  // そちらから同じ回数だけ AI を呼べてしまい、抑止が黙って外れる。
  ["POST /api/customer/fetch/stream", FETCH_RULE],
  ["POST /api/register/customer", REGISTER_RULE],
  ["POST /api/register/store", REGISTER_RULE],
  ["POST /api/customer/reports", REPORT_RULE],
  ["POST /api/auth/login", LOGIN_RULE],
]);

export const rateRuleFor = (method: string, path: string): RateRule | null => RULES_BY_ROUTE.get(`${method} ${path}`) ?? null;

/** 鍵を作るのに要る材料。defineRoute が見分けと入力の検査を終えた時点の値を渡す。 */
export type RateKeySource = {
  /** Cloudflare が付ける接続元（実行者への契約: 連打の抑止は cf-connecting-ip で数える） */
  ip: string | null;
  /** 客の入口なら客の番号。それ以外の入口では null */
  customerId: string | null;
  /** 検査を通った入力（ログインの入口のメールアドレスだけを見る） */
  input: unknown;
};

/** ログインの入口の入力からメールアドレスを取る。大小の違いで鍵が分かれないよう小文字へ揃える。 */
const loginEmailOf = (input: unknown): string => {
  const value = (input as { email?: unknown } | null | undefined)?.email;
  // 大文字の別名で数を分けられると、抑止そのものが無いのと同じになる（accounts の引き当ては大小を区別
  // するので、揃えたことで別のアカウントの数に混ざることはない）。
  return typeof value === "string" ? value.trim().toLowerCase() : "";
};

/**
 * 数の鍵。材料が無ければ null＝この要求は数えない（抑止を掛けない）。
 * 接続元の見出しが無いのは実物の Cloudflare では起きないが、無い値を1つの鍵へまとめると
 * 関係のない利用者どうしが1つの数を分け合うので、数えない側へ倒す（AI判断）。
 */
export const rateKeyFor = (rule: RateRule, source: RateKeySource): string | null => {
  const value = rule.by === "customer" ? source.customerId : rule.by === "ip" ? source.ip : loginEmailOf(source.input);
  return value ? `${rule.name}:${value}` : null;
};

/** 判定の結果。断らないときは、次に置く数え（窓の始まりと回数）を一緒に返す。 */
export type RateDecision = { refused: true } | { refused: false; next: RateCounterRow };

/**
 * 今の数えを見て、断るかどうかと、次に置く数えを決める（純粋な関数・時刻は呼ぶ側が渡す）。
 *
 * 窓は**固定**で、始まりは「その窓の最初の1回」。上限に届いた回だけ、窓の始まりをその時刻へ
 * 貼り直す——こうすると、上限に届いてから窓の長さのぶんきっちり断る（基準 30.4 の「15分間」が、
 * 10回目の失敗から15分になる）。断った回は数えない（断りで窓が延びると、いつまでも明けない）。
 *
 * ⚠️ 窓の始まりが日付として読めないとき（表が壊れた）は**新しい窓として数え直す**
 * （フェイルオープン・AI判断）。ここを断る側へ倒すと、壊れた1行でそのアカウントが永久に入れず、
 * 直す手が画面の側に無い。見分け（guards.ts）が期限をフェイルクローズにしているのと向きが逆だが、
 * あちらは「通してはいけないものを通す」危険、こちらは「通すべきものを断り続ける」危険で、重さが違う。
 */
export const decideRate = (rule: RateRule, counter: RateCounterRow | null, nowIso: string): RateDecision => {
  const nowMs = Date.parse(nowIso);
  const startMs = counter ? Date.parse(counter.windowStartIso) : Number.NaN;
  // NaN との比較は必ず false なので、壊れた値・行が無い場合はそのまま「窓の外」へ倒れる。
  const alive = counter !== null && startMs > nowMs - rule.windowMs ? counter : null;
  const count = alive?.count ?? 0;
  if (count >= rule.limit) return { refused: true };
  const next = count + 1;
  const windowStartIso = alive !== null && next < rule.limit ? alive.windowStartIso : nowIso;
  return { refused: false, next: { windowStartIso, count: next } };
};

/**
 * 手続きへ進めてよいか（手続きの前に呼ぶ）。
 * 要求を数える規則なら、ここで1回ぶんを足す——足すのが手続きより前なので、断った取得では
 * AI も地図も呼ばれない（基準 30.5）。落ちた要求だけを数える規則（ログイン）では、見るだけ。
 */
export const passRateLimit = async (deps: Deps, rule: RateRule, key: string): Promise<boolean> => {
  const decision = decideRate(rule, await findRateCounter(deps.db, key), deps.clock.now().toISOString());
  if (decision.refused) return false;
  if (rule.counts === "requests") await saveRateCounter(deps.db, key, decision.next);
  return true;
};

/**
 * 手続きの結果を数える（落ちた要求だけを数える規則のために、手続きの後に呼ぶ）。
 * 通ったら数を消す＝失敗の続きが切れる（基準 30.4 の「10回続く」）。
 */
export const recordRateOutcome = async (deps: Deps, rule: RateRule, key: string, succeeded: boolean): Promise<void> => {
  if (succeeded) {
    await deleteRateCounter(deps.db, key);
    return;
  }
  const decision = decideRate(rule, await findRateCounter(deps.db, key), deps.clock.now().toISOString());
  if (!decision.refused) await saveRateCounter(deps.db, key, decision.next);
};
