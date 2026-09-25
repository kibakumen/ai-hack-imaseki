// 人かどうかの確かめ（Turnstile）の実物（差し替え口 HumanCheck）。秘密鍵を使うのはここだけで、
// 画面には渡らない（サイトキーだけが adapters/env.ts 経由で GET /api/config/public に出る）。
// 打ち切りは呼ぶ側（http/defineRoute）が AbortSignal で渡す。
//
// 2026-09-25（監査の指摘 安全-23）: 答えの success だけを見ていたので、本番のサイトキーを自前の localhost の
// ページに置いて解いた値を、本番の登録やログインに流せた。Cloudflare の手引きどおり、答えの hostname
// （どのホスト名で解かれたか）と action（どの部品の用途で解かれたか）が呼ぶ側の期待と合うかを見る。
// hostname の無い答え（どこで解かれたか分からない）も人と認めない。接続元（remoteip）も渡す。

import type { HumanCheck, HumanCheckOptions } from "../ports";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare の試験用の秘密鍵（手元の開発で使う・公開の値）。これらは答えの hostname と action が
 * 決まった値（"localhost"・"test"）で返るので、場所と用途を見ない。どれも鍵そのものが確かめを素通しにする
 * （または必ず断る）ので、見ないことで守りが弱まることは無い。本番に入れてはいけない（README の手順）。
 */
const TEST_SECRET_KEYS: ReadonlySet<string> = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

export type TurnstileOptions = {
  /** Cloudflare の秘密鍵（秘密。束縛から読む） */
  secretKey: string;
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
};

type SiteverifyAnswer = { success?: unknown; hostname?: unknown; action?: unknown };

/** 答えが人のものと認められるか（success・解かれた場所・用途）。 */
const isHumanAnswer = (answer: SiteverifyAnswer, opts: HumanCheckOptions, isTestKey: boolean): boolean => {
  if (answer.success !== true) return false;
  if (isTestKey) return true;
  // どこで解かれたか分からない答えは認めない（期待のホスト名を渡されていなくても）。
  if (typeof answer.hostname !== "string" || answer.hostname === "") return false;
  if (opts.expectedHostname !== undefined && answer.hostname.toLowerCase() !== opts.expectedHostname.toLowerCase()) return false;
  if (opts.expectedAction !== undefined && answer.action !== opts.expectedAction) return false;
  return true;
};

export const createHumanCheck = ({ secretKey, fetch: fetchImpl = globalThis.fetch }: TurnstileOptions): HumanCheck => ({
  verify: async (token, opts) => {
    // 値が無ければ、外へ聞かずに「人ではない」と答える（断るのは呼ぶ側）。
    if (!token) return { ok: true, human: false };
    try {
      const body = new URLSearchParams({ secret: secretKey, response: token });
      if (opts.remoteIp) body.set("remoteip", opts.remoteIp);
      const res = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: opts.signal });
      if (!res.ok) return { ok: false };
      const answer = (await res.json()) as SiteverifyAnswer;
      return { ok: true, human: isHumanAnswer(answer, opts, TEST_SECRET_KEYS.has(secretKey)) };
    } catch {
      // 打ち切り・通信の失敗・JSON でない応答。確かめられなかったこと自体を返す（守りは外さない）。
      return { ok: false };
    }
  },
});
