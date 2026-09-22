// 客の画面でまず何を出すかの判断（設計書「客の画面」の「開いた時にまず何を出すか」の表）。
// 副作用なし・時計も引数で受け取る。部品はこの結果を描くだけで、自分では判断しない。
// 受け取り・受け取り直しの応答にも同じ結果が載る（設計書「入口の一覧」の注）。
//
// 上から順に当てて、最初に当たったものを出す:
//   1. 識別子が無い／受け付けられない        → 入口が 401 に倒す（ここには来ない）
//   2. 確保中の確保がある                    → 確保中の表示（基準 9.1・9.2・9.13）
//   3. いちばん新しい確保が期限切れで、期限から20分以内 → 期限切れの表示（コードつき・基準 11.5〜11.9）
//   4. いちばん新しい確保が、店に取り消された／運営に取り消された／期限から20分を過ぎた期限切れで、
//      その変化から3時間以内、かつ、そのあと1回も取得を押していない → 取り消しの表示（基準 9.6・9.7）
//   5. いちばん新しい確保が完了済みで、完了済みから一定の間      → 完了済みの表示（基準 9.3・9.4）
//   6. 上のどれでもない                      → 取得の画面（基準 9.5・1.8）
//
// ⚠️ タスク16（期限切れと受け取り直しの表示）・タスク22（通知の説明）への申し送りは下の注。

import { isReceivable, type OfferState } from "./offer";
import { effectiveState, isWithinExpiredGrace, type EffectiveState } from "./reservation";

/** 客の画面の表示の種類（受け入れ検査の契約 `HomeDto.kind`）。 */
export type CustomerHomeKind = "fetch" | "active" | "expired" | "completed" | "store_cancelled" | "admin_cancelled";

/**
 * 取り消しの表示（優先の順の4）を出し続ける長さ（3時間・AI判断）。
 * 3時間を過ぎて開いた客には、取り消しの表示の「探し直す」の行き先である取得の画面をはじめから出す。
 */
export const CANCELLED_VIEW_MS = 3 * 60 * 60 * 1000;

/**
 * 完了済みの表示（優先の順の5）を既定で出す長さ。
 *
 * ⚠️ **設計書の「3時間」ではなく30分にしてある**（2026-09-21 タスク13・AI判断・要確認）。
 * 設計書「客の画面」の優先の順の5は3時間と書いているが、凍結された受け入れ検査
 * `r20-arrivals.test.ts`（タスク17のブロック・20.6 の検査）が **完了済みから60分後のホームを
 * `fetch` だと決めている**（同ファイル 67〜69行）ので、3時間では通らない。60分より短い値が
 * 要るので、境界ぴったりで通す形（ちょうど60分）を避けて30分にした。
 * **どちらが本当かは設計者の判断**——3時間へ戻すなら r20 のその行も直す必要がある。
 * 3時間を過ぎても、次の確保を作るまでは取得の画面から完了済みの表示を開ける（基準 9.4・タスク14）。
 */
export const COMPLETED_VIEW_MS = 30 * 60 * 1000;

/** 確保1件ぶん（表の列と同じ名前。時刻は Date で受け取る——lib/domain は Date を作らない）。 */
export type HomeReservationRow = {
  id: string;
  code: string;
  storeId: string;
  storeName: string;
  storeAddress: string;
  storeUrl: string | null;
  party: number;
  expiresAt: Date;
  /** 状態が最後に変わった時刻（受け取った時は受け取った時刻） */
  statusAt: Date;
  status: string;
  /** 受け取った時点でそのオファーが見せていたクーポンの写し（基準 16.6） */
  coupons: Array<{ name: string; note: string }>;
  /** その確保を選んだ取得の起点（記録 `fetch_logs` から）。読めなければ null（省いても null と同じ） */
  origin?: { lat: number; lng: number } | null;
};

/** その確保のオファーの今（受け取り直せるかの判断に使う）。見つからなければ null。 */
export type HomeOfferRow = (OfferState & { partyMax: number }) | null;

export type CustomerHomeInput = {
  /** その客のいちばん新しい確保。1件も無ければ null */
  reservation: HomeReservationRow | null;
  offer: HomeOfferRow;
  /** その客が最後に取得を押した時刻（要件27の記録から）。1度も押していなければ null */
  lastFetchAt: Date | null;
};

/** 応答に載る確保（受け入れ検査の契約 `ReservationDto`）。時刻は ISO 8601 の文字列。 */
export type ReservationView = {
  id: string;
  code: string;
  storeId: string;
  storeName: string;
  storeAddress: string;
  storeUrl: string | null;
  party: number;
  expiresAt: string;
  status: EffectiveState;
  coupons: Array<{ name: string; note: string }>;
  /**
   * 探したときの起点（座標）。客の画面が経路の出発地に使う（2026-09-22 の本人の指摘・3回目）。
   * 応答に載せるので、画面の状態や端末の保存に依らずどのタブ・どの読み直しでも同じ出発地が渡る。
   * 受け入れ検査の契約 `ReservationDto` は `toMatchObject` で見ているので、項目を足しても通る。
   */
  origin: { lat: number; lng: number } | null;
};

/** 期限切れの表示の中身（基準 11.5〜11.9）。`partyMax` は「何名まで」が下がっていたときだけ。 */
export type ExpiredView = { showCode: boolean; canRetry: boolean; partyMax?: number };

export type CustomerHomeView = {
  kind: CustomerHomeKind;
  reservation?: ReservationView;
  expired?: ExpiredView;
};

const toView = (row: HomeReservationRow, state: EffectiveState, showCode: boolean): ReservationView => ({
  id: row.id,
  // 期限から20分を過ぎたらコードを消す（基準 11.9）。欄そのものは残す（画面が形を変えずに描ける）
  code: showCode ? row.code : "",
  storeId: row.storeId,
  storeName: row.storeName,
  storeAddress: row.storeAddress,
  storeUrl: row.storeUrl,
  party: row.party,
  expiresAt: row.expiresAt.toISOString(),
  status: state,
  coupons: row.coupons,
  origin: row.origin ?? null,
});

/**
 * 期限切れの確保を、同じ人数でもう一度受け取れるか（要件11の基準 11.8・11.10）。
 * 受け取れる状態（公開中で残りが1以上）で、人数がその時点の「何名まで」以下のときだけ。
 * 人数が超えているときは、その値を返す——画面が「◯名で探し直す」を出せるようにするため。
 */
export const retryability = (offer: HomeOfferRow, party: number, now: Date): { canRetry: boolean; partyMax?: number } => {
  if (!offer || !isReceivable(offer, now)) return { canRetry: false };
  if (party > offer.partyMax) return { canRetry: false, partyMax: offer.partyMax };
  return { canRetry: true };
};

/** 設計書の優先の順の表を、上から順にそのまま当てる。 */
export const customerHomeView = (input: CustomerHomeInput, now: Date): CustomerHomeView => {
  const row = input.reservation;
  if (!row) return { kind: "fetch" };
  const state = effectiveState(row, now);

  // 2. 確保中
  if (state === "active") return { kind: "active", reservation: toView(row, state, true) };

  const sinceChange = now.getTime() - row.statusAt.getTime();
  // 4 の「そのあと1回も取得を押していない」（状態が変わったあとに押していれば、客は探しに来ている）
  const fetchedSince = input.lastFetchAt !== null && input.lastFetchAt.getTime() > row.statusAt.getTime();

  // 3・4 の期限切れ（変化の時刻は期限の時刻。書き込みは起きないので status_at は受け取った時刻のまま）
  if (state === "expired") {
    const withinGrace = isWithinExpiredGrace(row, now);
    if (withinGrace) {
      return { kind: "expired", reservation: toView(row, state, true), expired: { showCode: true, ...retryability(input.offer, row.party, now) } };
    }
    const sinceExpiry = now.getTime() - row.expiresAt.getTime();
    if (sinceExpiry < CANCELLED_VIEW_MS && !fetchedSince) {
      return { kind: "expired", reservation: toView(row, state, false), expired: { showCode: false, canRetry: false } };
    }
    return { kind: "fetch" };
  }

  // 4. 店が取り消した・運営に取り消された
  if (state === "store_cancelled" || state === "admin_cancelled") {
    if (sinceChange < CANCELLED_VIEW_MS && !fetchedSince) return { kind: state, reservation: toView(row, state, true) };
    return { kind: "fetch" };
  }

  // 5. 完了済み
  if (state === "completed" && sinceChange < COMPLETED_VIEW_MS) {
    return { kind: "completed", reservation: toView(row, state, true) };
  }

  // 6. 客が取り消したあと（基準 9.5）と、上の幅を過ぎたもの
  return { kind: "fetch" };
};
