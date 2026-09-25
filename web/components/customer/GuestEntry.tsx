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
// 客の登録は要件1として決まっており、受け入れ検査が「ホームが 401 なら登録の入力を出し、取得の画面は
// 出さない」（基準 1.10・1.11）を見ている。だから `CustomerApp` の描き方は変えず、ここが開いた瞬間に
// 登録を済ませて、`CustomerApp` が 200 のホームを受け取るようにする。自動の登録が通らなかったときは
// `CustomerApp` をそのまま描く＝受け皿の登録の入力が出る（呼び名は自動で入り、電話番号は任意）。
//
// 集めるものは要件のまま（呼び名・電話番号）だが、**客には聞かない**（`lib/client/guestIdentity`）:
//   - 呼び名は `guest-xxxxxx` を作る。店は照合コードで客を見分けるので、本人の名前は要らない。
//   - 電話番号は形だけを満たす仮の値。店が緊急時に連絡できる先は、取得の画面のこだわり条件の
//     いちばん下から任意で入れられる。登録そのものは /me の下端の「この端末の登録を消す」で消せる。
//
// 2026-09-25 監査の指摘で直した2つ:
//   - 不具合-22: 「一度だけ走らせる印」と片付けの印が組み合わさって、開発時の StrictMode（effect を
//     実行→片付け→再実行）で準備中のまま進まなかった。印をやめ、effect は毎回始めて片付けで打ち切る。
//     二重の登録は「送る直前にまだ打ち切られていないか」を見て防ぐ。
//   - 客-02: 35%の濃さに縮めた確かめの部品と「準備をしています…」だけで最長15秒待たせ、押すよう促す文も
//     無いまま登録の画面へ落としていた。3秒たっても値が来なければ部品を普通の濃さに戻して押すよう促し、
//     **部品を描いたまま**待つ。部品が失敗を知らせたら待たずに受け皿へ。遅れた値を拾う別の待ち（部品ごと
//     外していたので値が二度と届かなかった）は消した。

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { callApi, getPublicConfig, isFailure, isUnauthenticated } from "../../lib/client/api";
import { guestNickname, phoneOrPlaceholder } from "../../lib/client/guestIdentity";
import { HUMAN_CHECK_ACTIONS } from "../../lib/schemas/limits";
import { HumanCheck } from "../ui/HumanCheck";
import { CustomerApp } from "./CustomerApp";

/** 確かめの値がこれだけ来なければ、部品を普通の濃さで見せて押すよう促す（客-02 の案A・AI判断の値）。 */
const HUMAN_CHECK_HINT_MS = 3000;
/**
 * 確かめの値を待つ上限。部品を描いたまま待つので、対話の確かめを客が押す時間も入る（旧: 15秒で打ち切り、
 * そのあと部品を外したまま45秒待っていた）。過ぎたら受け皿の登録の入力へ倒れる（値なしでは送らない・不具合-04）。
 * ⚠️ 自動の登録は確かめが通ることに依っている——守りを緩めて通す道は作らない（設計書「人かどうかの確かめ」）。
 */
const HUMAN_TOKEN_WAIT_MS = 60000;
/** 値が届いたかを見に行く間隔（AI判断。待ち時間の刻み）。 */
const TOKEN_POLL_MS = 100;

type Phase =
  /** ホームを1回だけ叩いて、識別子を持っているかを見ている */
  | "checking"
  /** 識別子が無い。人かどうかの確かめの値を待って、裏で登録する */
  | "registering"
  /** 登録の要否が決まった（通ったか、諦めたか）。`CustomerApp` に渡す */
  | "ready"
  /**
   * 登録が混み合って断られた（429・rate_limited・不具合-04）。手の登録の入力へ落とさない——
   * 同じ回線から送り直しても同じ断りを受けるだけなので、待ってから開き直す道を出す。
   */
  | "busy";

/** 登録を1回送った結果。混み合いの断りだけは、手の登録へ倒さずに分けて扱う。 */
type RegisterOutcome = "registered" | "refused" | "busy";

const isRateLimited = (answer: unknown): boolean => isFailure(answer) && answer.error?.kind === "rate_limited";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 裏の登録を1回送る。 */
const sendRegistration = async (humanToken: string): Promise<RegisterOutcome> => {
  const answer = await callApi("POST /api/register/customer", {
    body: { nickname: guestNickname(), phone: phoneOrPlaceholder(""), genres: [], budgetMax: null, humanToken },
  });
  if (isRateLimited(answer)) return "busy";
  return isFailure(answer) ? "refused" : "registered";
};

export const GuestEntry = () => {
  const [phase, setPhase] = useState<Phase>("checking");
  const [siteKey, setSiteKey] = useState<string | null>(null);
  /** 確かめの値が3秒来ない（部品を普通の濃さで見せて押すよう促す） */
  const [slow, setSlow] = useState(false);
  // 確かめの値は使い切りなので、届いた値を「1回だけ使う」形で持つ。部品の失敗も同じく印で受ける。
  const tokenRef = useRef<string | null>(null);
  const failedRef = useRef(false);

  const handleToken = useCallback((token: string) => {
    tokenRef.current = token;
  }, []);
  const handleError = useCallback(() => {
    failedRef.current = true;
  }, []);

  useEffect(() => {
    // 片付けで打ち切る（StrictMode の1回目・画面を離れたとき）。打ち切られた回は何も変えず、何も送らない。
    let alive = true;

    /** 値が届くか、部品が失敗するか、上限を過ぎるまで待つ。値が無ければ null。 */
    const waitForToken = async (): Promise<string | null> => {
      const startedAt = Date.now();
      while (tokenRef.current === null && !failedRef.current && Date.now() - startedAt < HUMAN_TOKEN_WAIT_MS) {
        await sleep(TOKEN_POLL_MS);
        if (!alive) return null;
        if (Date.now() - startedAt >= HUMAN_CHECK_HINT_MS) setSlow(true);
      }
      return tokenRef.current;
    };

    void (async () => {
      // 1. 識別子を持っているか。**登録へ進むのは「識別子が無い・受け付けられない」（401・unauthenticated）
      //    ときだけ**（設計書「客の画面」の優先の順の1）。サーバーの不具合・通信の失敗・応答の形の崩れで
      //    登録すると、新しい識別子の Cookie が今の Cookie を上書きし、確保中の客が店で見せるコードへ二度と
      //    戻れなくなる（不具合-02）。それ以外は `CustomerApp` に任せる。
      const home = await callApi("GET /api/customer/home");
      if (!alive) return;
      if (!isUnauthenticated(home)) {
        setPhase("ready");
        return;
      }

      // 2. 持っていない。人かどうかの確かめの部品を出して、値が届くのを待つ。サイトキーが取れないときは
      //    値を作る部品を描けないので、待たずに受け皿へ（値の無い登録は送らない・不具合-04）。
      const config = await getPublicConfig();
      if (!alive) return;
      const key = config?.turnstileSiteKey ?? "";
      if (key === "") {
        setPhase("ready");
        return;
      }
      setSiteKey(key);
      setPhase("registering");
      const token = await waitForToken();
      // 送る直前にまだ打ち切られていないかを見る（二重の登録を防ぐ）
      if (!alive) return;
      if (token === null) {
        setPhase("ready");
        return;
      }

      // 3. 裏で登録する。通れば `CustomerApp` は 200 のホームを受け取る。断られたら受け皿の登録の入力へ。
      tokenRef.current = null;
      const outcome = await sendRegistration(token);
      if (!alive) return;
      setPhase(outcome === "busy" ? "busy" : "ready");
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (phase === "ready") return <CustomerApp />;

  if (phase === "busy") {
    return (
      <main data-testid="guest-entry-busy">
        <p role="alert">ただいま混み合っています。少し時間をおいてから、このページを開き直してください。</p>
        <button type="button" onClick={() => window.location.reload()}>
          開き直す
        </button>
      </main>
    );
  }

  return (
    <main aria-busy="true" data-testid="guest-entry">
      <p>お店を探す準備をしています…</p>
      {slow ? (
        <p className="human-check-prompt" role="status" data-testid="human-check-prompt">
          下の確認を押してください。押すと、すぐに探せるようになります。
        </p>
      ) : null}
      {/* 確かめの部品は描かれていないと値を作れない。初めの3秒は目立たせず、来なければ普通の濃さで見せる */}
      {siteKey !== null ? (
        <div className={slow ? "human-check-visible" : "human-check-quiet"}>
          <HumanCheck siteKey={siteKey} action={HUMAN_CHECK_ACTIONS.registerCustomer} onToken={handleToken} onError={handleError} />
        </div>
      ) : null}
      {/* 送り始める前に、どこへ何が送られるかを1行で添える（2026-09-25 監査の指摘 安全-18） */}
      {siteKey !== null ? (
        <p className="human-check-note" data-testid="human-check-note">
          人かどうかの確かめに Cloudflare Turnstile を使い、ブラウザの情報が Cloudflare に送られます（<Link href="/privacy">送信先の一覧</Link>）。
        </p>
      ) : null}
    </main>
  );
};

export default GuestEntry;
