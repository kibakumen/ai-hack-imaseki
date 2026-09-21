// 過去の受け取りの一覧の読み取り（要件8の基準 8.11【最終日】）。lib/repo は D1 の SQL。
//
// ⚠️ 列の名前を写さない: 確保の列は repo/reservations.ts の `RESERVATION_COLUMNS` と
//    `toReservationRow` を使う（タスク13 からの申し送り）。確保の表の別名は **`res`** で固定
//    （`r` は使わない・repo/reservations.ts の注）。
//
// ⚠️ 状態は導かない。保存されている status と期限の時刻をそのまま返し、「期限切れ」を導くのは
//    domain/reservation.ts の `effectiveState`（呼ぶのは usecases/customerHistory）。
//
// ⚠️ 別の客の確保が1行も混ざらないことは、この WHERE だけが担う（基準 2.5）。客の番号は入口が
//    Cookie から見分けた値で、要求の本文からは受けない。

import type { Deps } from "../ports";
import { RESERVATION_COLUMNS, toReservationRow, type ReservationRow } from "./reservations";

type Db = Deps["db"];

/** 確保1件と、見返しに出すその店の3つ（基準 8.11 の店名・住所・ホームページの URL）。 */
export type CustomerHistoryRow = {
  reservation: ReservationRow;
  store: { name: string; address: string; url: string | null };
};

const HISTORY_SQL =
  `SELECT ${RESERVATION_COLUMNS}, s.name AS store_name, s.address AS store_address, s.url AS store_url` +
  ` FROM reservations res` +
  ` JOIN stores s ON s.id = res.store_id` +
  ` WHERE res.customer_id = ?1` +
  ` ORDER BY res.created_at DESC, res.rowid DESC`;

/**
 * その客が受け取った確保を、受け取った時刻の新しい順に全部（基準 8.11）。
 *
 * 絞り込まない——確保中のものも、完了済みも、取り消されたものも、期限切れのままのものも出す
 * （見返しは「何を受け取ってどうなったか」を思い出すためのもの。行っていない店を隠す「最近行った店」
 * 〔基準 26.17〕とは別の一覧）。同じ時刻の2件は後に入った行を先に出す（`rowid DESC`）。
 */
export const listReservationsOfCustomer = async (db: Db, customerId: string): Promise<CustomerHistoryRow[]> => {
  const result = await db.prepare(HISTORY_SQL).bind(customerId).all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    reservation: toReservationRow(row),
    store: {
      name: (row.store_name as string | null) ?? "",
      address: (row.store_address as string | null) ?? "",
      url: (row.store_url as string | null) ?? null,
    },
  }));
};
