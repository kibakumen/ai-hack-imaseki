"use client";

// 取得の結果の一覧（要件4の基準 4.4・4.5・4.7・4.10・4.11・4.14）。サーバーが返した並びのまま描く
// ——並びは点数順で手続きが決めており（基準 4.12）、画面は並べ替えない。
// 1件ごとに受け取りの操作を1つだけ置き、クーポンを選ぶ操作は置かない（基準 4.11）。
//
// ⚠️ 受け取りを押したときの動き（入口の呼び出し・断りの表示 `RefusalNotice`・確保中の表示への
// 切り替え）はタスク14 がここへ足す。このタスクは押せる形と一覧の表示までで、`onReceive` が
// その受け皿（設計書「客の画面」の結果の行）。

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
  /** 受け取りを押したときの受け皿（タスク14 が繋ぐ）。 */
  onReceive?: (item: ResultItem) => void;
};

/** 金額は3桁ごとに区切って出す（読み違えを減らすための表示だけの整形）。 */
const yen = (amount: number): string => `${amount.toLocaleString("ja-JP")}円`;

/** 結果が0件のときの次の手（基準 4.4・4.5）。人数・場所・時間の3つを必ず出す。 */
const EmptyResult = () => (
  <p data-testid="result-empty">
    今の条件で入れるお店は見つかりませんでした。人数を減らすと見つかることがあります。場所を変える・少し時間を置いてもう一度探す、のも試せます。
  </p>
);

const ResultCard = ({ item, onReceive }: { item: ResultItem; onReceive?: (item: ResultItem) => void }) => (
  <li className="result-card" data-testid={`result-${item.offerId}`}>
    <h3>{item.storeName}</h3>
    <p>
      徒歩{item.walkMinutes}分 ／ 1人あたり {yen(item.budgetMin)}〜{yen(item.budgetMax)} ／ {item.partyMax}名まで
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
    <button type="button" data-testid="btn-receive" onClick={() => onReceive?.(item)}>
      この店に行く（20分間 席を確保）
    </button>
  </li>
);

export const ResultList = ({ items, onReceive }: ResultListProps) => (
  <section data-testid="result-list">
    <h2>今入れるお店</h2>
    {items.length === 0 ? (
      <EmptyResult />
    ) : (
      <ul className="result-cards">
        {items.map((item) => (
          <ResultCard key={item.offerId} item={item} onReceive={onReceive} />
        ))}
      </ul>
    )}
  </section>
);

export default ResultList;
