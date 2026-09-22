"use client";

// 客の画面の入口。**登録を客に見せずに済ませる**ための1枚（2026-09-22 の本人の指摘）。
//
//   「そもそも登録いる？ 今すぐ探すときに必要項目を一緒に入力すればよくない？」
//   「名前とかも電話番号と照合コードがあるからいらない気がする。顧客自体の識別が必要なら
//     適当な文字列でも生成しといて」
//   「理想は電話番号も含めて未入力で、場所は現在地がデフォルトで入力され、予算や好みも未入力可で、
//     その気になれば画面を開いた瞬間に今すぐ探すボタンを押せること」
//
// **なぜ `CustomerApp` の中ではなくこの1枚を被せる形にしたか**
// 客の登録は要件1として決まっており、受け入れ検査（`tests/acceptance/v2/r01-customer-register.ui.test.tsx`）が
// 「ホームが 401 なら登録の入力を出し、取得の画面は出さない」（基準 1.10・1.11）を `CustomerApp` に対して
// 見ている。だから**部品の描き方は変えない**——変えるのは「実際のアプリが 401 のままにならないこと」だけ。
// ここが開いた瞬間に登録を済ませるので、`CustomerApp` は 200 のホームを受け取り、いきなり取得の画面を出す。
// 自動の登録が通らなかったときは `CustomerApp` をそのまま描く＝客が手で入れる登録の入力が出る（受け皿）。
//
// 集めるものは要件のまま（呼び名・電話番号）だが、**客には聞かない**:
//   - 呼び名は `guest-xxxxxx` を作る。店は照合コードで客を見分けるので、本人の名前は要らない。
//   - 電話番号は形だけを満たす仮の値。店が緊急時に連絡できる先は、客が登録の確認の画面から
//     あとで入れ直せる（`AccountSettings`）。
// どちらも「客が入れなくても探し始められる」ことを優先した結果で、要件の項目自体は減らしていない。

import { useCallback, useEffect, useRef, useState } from "react";
import { apiCall, getPublicConfig, isFailure } from "../../lib/client/api";
import { GUEST_PHONE_PLACEHOLDER } from "../../lib/schemas/limits";
import { HumanCheck, type HumanCheckHandle } from "../ui/HumanCheck";
import { CustomerApp } from "./CustomerApp";

/** 自動で作る呼び名。`guest-` ＋ 6字（呼び名の上限20字に収まる）。 */
const guestNickname = (): string => `guest-${Math.random().toString(36).slice(2, 8)}`;
/**
 * 仮の電話番号（形の正本は `schemas/limits.ts` の `PHONE_PATTERN`＝0 で始まる10〜11桁。値は
 * `GUEST_PHONE_PLACEHOLDER`——取得の画面の電話番号の欄が「仮のまま」を見分けるのに同じ値を読む）。
 * 実在しない番号を入れるのは、**客に聞かずに登録を済ませる**ため。店が本当に連絡したい場面は
 * 「来ない客への確認」で、そこは照合コードと来店の記録で足りる（本人の指摘）。
 * 本物の番号は、取得の画面のこだわり条件のいちばん下から任意で入れられる（2026-09-22 本人の指摘）。
 */
const PLACEHOLDER_PHONE = GUEST_PHONE_PLACEHOLDER;

/**
 * 人かどうかの確かめの値を待つ上限。これを過ぎたら値なしで送る（＝断られて手の登録へ倒れる）。
 * ⚠️ 確かめが働いていない間（サイトキーのホスト名の設定が合っていない等）は、客はここで待たされた
 * あとに手の登録の画面を見る。**自動の登録は確かめが通ることに依っている**——守りを緩めて通す道は
 * 作らない（設計書「人かどうかの確かめ」: 確かめが取れないときも断る・本人選択）。
 */
const HUMAN_TOKEN_WAIT_MS = 4000;
/** 値が届いたかを見に行く間隔（AI判断。待ち時間の刻み）。 */
const TOKEN_POLL_MS = 100;

type Phase =
  /** ホームを1回だけ叩いて、識別子を持っているかを見ている */
  | "checking"
  /** 識別子が無い。人かどうかの確かめの値を待って、裏で登録する */
  | "registering"
  /** 登録の要否が決まった（通ったか、諦めたか）。`CustomerApp` に渡す */
  | "ready";

export const GuestEntry = () => {
  const [phase, setPhase] = useState<Phase>("checking");
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const humanRef = useRef<HumanCheckHandle | null>(null);
  // 確かめの値は使い切りなので、届いた値を「1回だけ使う」形で持つ（登録に使ったら捨てる）。
  const tokenRef = useRef<string | null>(null);
  /** 二重に登録しないための印（描き直しで effect がもう一度走っても1回だけ送る）。 */
  const startedRef = useRef(false);

  const handleToken = useCallback((token: string) => {
    tokenRef.current = token;
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let alive = true;

    void (async () => {
      // 1. 識別子を持っているか（持っていれば何もしない）。
      const home = await apiCall("GET", "/api/customer/home");
      if (!alive) return;
      if (!isFailure(home)) {
        setPhase("ready");
        return;
      }

      // 2. 持っていない。人かどうかの確かめの部品を出して、値が届くのを待つ。
      const config = await getPublicConfig();
      if (!alive) return;
      const key = config?.turnstileSiteKey ?? "";
      if (key !== "") setSiteKey(key);
      setPhase("registering");

      // 3. 値が届いたら（または待ちきれなかったら）、裏で登録する。
      //    サイトキーが取れていないときは待たない——値を作る部品を描けないので、待つだけ無駄に遅くなる。
      const waitedUntil = Date.now() + (key === "" ? 0 : HUMAN_TOKEN_WAIT_MS);
      while (tokenRef.current === null && Date.now() < waitedUntil) {
        await new Promise((resolve) => setTimeout(resolve, TOKEN_POLL_MS));
        if (!alive) return;
      }
      const humanToken = tokenRef.current;
      tokenRef.current = null;
      await apiCall("POST", "/api/register/customer", {
        nickname: guestNickname(),
        phone: PLACEHOLDER_PHONE,
        genres: [],
        budgetMax: null,
        humanToken,
      });
      if (!alive) return;
      // 通ったかどうかで分けない——通れば `CustomerApp` が 200 のホームを受け取って取得の画面を出し、
      // 通らなければ 401 のまま登録の入力が出る（受け皿）。判断はホームの1か所に任せる。
      setPhase("ready");
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (phase === "ready") return <CustomerApp />;

  return (
    <main aria-busy="true" data-testid="guest-entry">
      <p>お店を探す準備をしています…</p>
      {/* 確かめの部品は描かれていないと値を作れない。客の目に触れない置き方は CSS 側の仕事。 */}
      {siteKey !== null ? (
        <div className="human-check-quiet">
          <HumanCheck ref={humanRef} siteKey={siteKey} onToken={handleToken} />
        </div>
      ) : null}
    </main>
  );
};

export default GuestEntry;
