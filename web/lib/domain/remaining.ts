// 残りの数の TS 側の正本（設計書「どの判断をどこに置くか」の「残りの数」の行）。
// SQL 側は repo/sqlFragments.ts の `holdsSlotCondition`・`remainingExpression` で、
// 2つが同じ答えを出すことを受け入れ検査 r18 が突き合わせる（`assertTsMatchesSql`）。
//
// 残り ＝ 募集する組数（capacity）− 枠を押さえている確保の数（設計書「確保の状態と、残りの数え方」）。
// 枠を押さえているのは次の3つだけ:
//   1. 確保中（status='active'）で、今が期限より前
//   2. 完了済みで holds_slot=1（確保中から完了済みにしたものは常に1。期限切れから完了済みに
//      したものは、押した時点の残りが1以上なら1、0なら0・基準 18.7・18.8）
//   3. 店が取り消したもので holds_slot=1（店の都合の取り消しは押さえたまま・基準 18.4・18.5。
//      「来ない（枠を戻す）」で取り消したものは holds_slot=0 で押さえない・基準 18.16・2026-09-26 本人選択）
//
// ⚠️ 0 で畳まない（SQL の式と同じ答えを出すのがこの関数の仕事）。画面に出すときに畳むのは
//    読む側（usecases/storeHomeOffer の `toOfferView`）の仕事。

/** 残りの計算に要る確保1行ぶん（表の列と同じ名前。`holdsSlot` は D1 が 0／1 を返す）。 */
export type SlotRow = {
  status: string;
  expiresAt: Date;
  holdsSlot: number | boolean;
};

/** その確保が今、オファーの枠を1つ押さえているか。SQL の `holdsSlotCondition` と同じ順・同じ条件。 */
export const holdsSlot = (row: SlotRow, now: Date): boolean => {
  if (row.status === "active") return row.expiresAt.getTime() > now.getTime();
  if (row.status === "completed" || row.status === "store_cancelled") return row.holdsSlot === 1 || row.holdsSlot === true;
  return false;
};

/** 残り ＝ 募集する組数 − 枠を押さえている確保の数（要件18）。 */
export const remainingOf = (capacity: number, rows: readonly SlotRow[], now: Date): number =>
  capacity - rows.filter((row) => holdsSlot(row, now)).length;
