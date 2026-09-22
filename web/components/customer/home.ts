// 客の画面が読む応答の形（`GET /api/customer/home` と、受け取り・受け取り直しの応答に載る `home`）。
//
// 手続き側の正本は `lib/domain/customerHome.ts` の `CustomerHomeView` だが、部品・画面は lib/domain を
// 読めない（設計書「依存の向き」）ので、**画面が要る形だけ**をここに置く（結果の1件を `ResultList` が
// 持っているのと同じ置き方）。`client/api.ts` が形を確かめるのは断りの応答だけなので、**在ることに
// 頼らずに読む**（`reservation` と `expired` は場面によって無い）。

/** 確保1件（応答 `ReservationDto`）。時刻は ISO 8601 の文字列。 */
export type ReservationDto = {
  id: string;
  code: string;
  storeId: string;
  storeName: string;
  storeAddress: string;
  storeUrl: string | null;
  party: number;
  expiresAt: string;
  status: string;
  coupons: Array<{ name: string; note: string }>;
  /**
   * 探したときの起点（サーバーが `fetch_logs` から載せる座標・2026-09-22）。経路の出発地に使う。
   * 古い応答・端末に残した古いホームには無いので、**在ることに頼らない**（無ければ画面側の覚えで補う）。
   */
  origin?: { lat: number; lng: number } | null;
};

/** 期限切れの表示の中身（要件11の基準 11.6〜11.9。判断はサーバー側の `domain/customerHome`）。 */
export type ExpiredDto = { showCode: boolean; canRetry: boolean; partyMax?: number };

/** 客の画面が開いた時にまず出すもの（設計書「客の画面」の優先の順）。 */
export type HomeDto = {
  /** まだ通知を許可していない客だけ true（要件22の基準 22.8・タスク19 が足した） */
  pushPromptDue?: boolean;
  kind: "fetch" | "active" | "expired" | "completed" | "store_cancelled" | "admin_cancelled";
  /**
   * 登録の値。呼び名と電話番号は、取得の画面の電話番号の欄（任意・2026-09-22）が登録の変更の入口
   * `PATCH /api/customer/profile` へ4項目まとめて送るために読む（送られなかった項目は残らない形のため）。
   */
  profile?: { nickname?: string; phone?: string; genres?: string[]; budgetMax?: number | null };
  reservation?: ReservationDto;
  expired?: ExpiredDto;
};

/**
 * 受け取り・受け取り直しが断られた理由と次の一手（409 の `refusal`）。
 * どちらも手続き（`usecases/receiveOffer`）が決めたものを、画面はそのまま描く。
 * 描くのは `RefusalNotice` ただ1つ（設計書「受け取りが断られたとき」の5）。
 */
export type ReceiveRefusal = { kind: string; nextStep: string; partyMax?: number };
