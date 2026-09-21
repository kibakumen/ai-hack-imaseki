"use client";

// 取得の結果の一覧（要件4の基準 4.4・4.5・4.7・4.10・4.11・4.14）。サーバーが返した並びのまま描く
// ——並びは点数順で手続きが決めており（基準 4.12）、画面は並べ替えない。
// 1件ごとに受け取りの操作を1つだけ置き、クーポンを選ぶ操作は置かない（基準 4.11）。
//
// 受け取りを押したときの動き（入口の呼び出し・確保中の表示への切り替え）は入れ物（`CustomerApp`）が
// 持ち、この部品は押せたことを `onReceive` で渡すだけ。断られたときは、**押したカードの中**に
// `RefusalNotice` を出し、ほかのカードはそのまま残す（基準 8.6・設計書「受け取りが断られたとき」の3。
// 一覧は取り直さない——古い画面から押せることを前提に、押した瞬間の書き込みだけを本物とする）。
// 確保中の確保を持ったまま探しているときは、受け取りの操作を選べない形にする（基準 8.10）。

import type { ReceiveRefusal } from "./home";
import { RefusalNotice } from "./RefusalNotice";

/** 結果の1件（応答 `POST /api/customer/fetch` の `items[]`）。手続き側の正本は `usecases/fetchOffers` の
 * `FetchResultItem` で、部品は `lib/usecases` を読めない（依存の向き）ので、画面が要る形をここに置く。 */
export type ResultItem = {
  offerId: string;
  storeId: string;
  storeName: string;
  walkMinutes: number;
  budgetMin: number;
  budgetMax: number;
  reason: string;
  partyMax: number;
  coupons: Array<{ name: string; note: string }>;
  storeUrl: string | null;
};

type ResultListProps = {
  items: ResultItem[];
  /** 受け取りを押したときの受け皿（入口を呼ぶのは `CustomerApp`）。 */
  onReceive?: (item: ResultItem) => void;
  /**
   * 受け取りが断られた1件（基準 8.6）。**押したカードの中だけ**に出す。
   * `body.partyMax` が在れば、そのカードの「◯名まで」は応答の値に直す（店が下げていたということ）。
   */
  refusal?: { offerId: string; body: ReceiveRefusal } | null;
  /** 断りの「次の一手」を押したときの受け皿（行き先は `CustomerApp` が決める）。 */
  onNextStep?: () => void;
  /** 確保中の確保を持ったまま探しているか（基準 8.10）。受け取りの操作を選べない形にする。 */
  holding?: boolean;
  onBackToReservation?: () => void;
};

/** 金額は3桁ごとに区切って出す（読み違えを減らすための表示だけの整形）。 */
const yen = (amount: number): string => `${amount.toLocaleString("ja-JP")}円`;

/** 結果が0件のときの次の手（基準 4.4・4.5）。人数・場所・時間の3つを必ず出す。 */
const EmptyResult = () => (
  <p data-testid="result-empty">
    今の条件で入れるお店は見つかりませんでした。人数を減らすと見つかることがあります。場所を変える・少し時間を置いてもう一度探す、のも試せます。
  </p>
);

type ResultCardProps = {
  item: ResultItem;
  onReceive?: (item: ResultItem) => void;
  /** このカードが断られた1件のときだけ渡る。 */
  refusal?: ReceiveRefusal | null;
  onNextStep?: () => void;
  holding?: boolean;
};

const ResultCard = ({ item, onReceive, refusal = null, onNextStep, holding = false }: ResultCardProps) => (
  <li className="result-card" data-testid={`result-${item.offerId}`}>
    <h3>{item.storeName}</h3>
    <p>
      徒歩{item.walkMinutes}分 ／ 1人あたり {yen(item.budgetMin)}〜{yen(item.budgetMax)} ／ {refusal?.partyMax ?? item.partyMax}名まで
    </p>
    <p>{item.reason}</p>
    <p>クーポン</p>
    <ul className="coupon-list" data-testid="coupon-list">
      {item.coupons.map((coupon, index) => (
        <li key={`${coupon.name}-${index}`}>
          {coupon.name}
          {coupon.note === "" ? null : `（${coupon.note}）`}
        </li>
      ))}
    </ul>
    {item.storeUrl === null ? null : (
      <a href={item.storeUrl} target="_blank" rel="noreferrer">
        お店のホームページを見る
      </a>
    )}
    <button type="button" data-testid="btn-receive" disabled={holding} onClick={() => onReceive?.(item)}>
      この店に行く（20分間 席を確保）
    </button>
    {refusal === null ? null : <RefusalNotice refusal={refusal} onNextStep={() => onNextStep?.()} />}
  </li>
);

/** 確保を持ったまま探しているときの案内（基準 8.10）。取り消せば受け取れることと、戻る入口。 */
const HoldNotice = ({ onBackToReservation }: { onBackToReservation?: () => void }) => (
  <p data-testid="result-hold-notice">
    今の確保を取り消すと受け取れます。
    <button type="button" data-testid="btn-back-to-reservation" onClick={() => onBackToReservation?.()}>
      確保中の表示へ戻る
    </button>
  </p>
);

export const ResultList = ({ items, onReceive, refusal = null, onNextStep, holding = false, onBackToReservation }: ResultListProps) => (
  <section data-testid="result-list">
    <h2>今入れるお店</h2>
    {holding ? <HoldNotice onBackToReservation={onBackToReservation} /> : null}
    {items.length === 0 ? (
      <EmptyResult />
    ) : (
      <ul className="result-cards">
        {items.map((item) => (
          <ResultCard
            key={item.offerId}
            item={item}
            onReceive={onReceive}
            refusal={refusal !== null && refusal.offerId === item.offerId ? refusal.body : null}
            onNextStep={onNextStep}
            holding={holding}
          />
        ))}
      </ul>
    )}
  </section>
);

export default ResultList;
