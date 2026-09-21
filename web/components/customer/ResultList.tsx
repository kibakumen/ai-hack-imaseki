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
//
// ---- 見た目（2026-09-22。速成版 `sprint/app/me/page.tsx` から移した）----
// 本人の指摘は「何か全体的にオファーカードにワクワク感を感じない・**オファーのプレミアムで
// 楽しい感じが伝わるデザイン**にしてほしい」「アピール説明の大きさなどが控えめなので**もっと
// アピールするようなデザイン**に」「**クーポンが小カード**にして見えるように」「**お店の画像**もほしい」。
// 応えた形は4つ:
//   1. カードを丸く・影つきの暖色のグラデーションにし、上から順に出す（`rise-in`）
//   2. 紹介文（`reason`）をカードでいちばん大きい文にし、届いた瞬間に縁で光らせる（`OfferPitch`）
//   3. クーポンを1枚ずつの小さな札にする
//   4. 店の雰囲気の面を上に置く（`OfferArt`）
// 色の値はここに持たない（要件32の基準 32.3）——形と動きだけを class 名で指し、色は
// `app/globals.css` の変数と `app/me/me.css` が持つ。

import type { ReceiveRefusal } from "./home";
import { OfferReveal } from "./OfferReveal";
import { RefusalNotice } from "./RefusalNotice";
import { StoreImage } from "./StoreImage";

/**
 * 紹介文の出どころ（少しずつ届く入口の `pitch` フレームの `source`）。
 *   undefined … まだ届いていない（書いている最中。シマーを重ねて待たせる）
 *   persona   … 人格を持った常連が書いた文が届いた（いちばん強く見せる）
 *   fallback  … 簡素な文へ倒した（客には失敗として見せない・普通に出す）
 */
export type PitchSource = "persona" | "fallback";

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
  /** 紹介文が届いたか（`FetchForm` が少しずつ届く入口から入れる。無ければ「書いている最中」） */
  pitchSource?: PitchSource;
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
  <p className="offer-empty" data-testid="result-empty">
    今の条件で入れるお店は見つかりませんでした。人数を減らすと見つかることがあります。場所を変える・少し時間を置いてもう一度探す、のも試せます。
  </p>
);

/**
 * 店の雰囲気の面（第1回の指摘「お店の画像もほしい」・第2回の指摘で実装。2026-09-22 移植）。
 * ホームページの URL があれば `StoreImage` が og:image / twitter:image を取りに行き、取れれば
 * それを見せる。取れない・URL が無い・まだ届いていない間は、下の飾りの地（絵文字＋グラデーション）
 * がそのまま見える——**画像は飾りなので、落ちても本文は出る**。
 * 店ごとに地の傾きを変えて、同じ絵が並んで見えないようにする（番号ではなく店の名前から決めるので、
 * 並びが変わっても同じ店は同じ地になる）。
 */
const OfferArt = ({ storeName, storeUrl }: { storeName: string; storeUrl: string | null }) => {
  const tilt = [...storeName].reduce((sum, ch) => sum + ch.codePointAt(0)!, 0) % 4;
  return (
    <div aria-hidden className="offer-card__art" data-tilt={tilt}>
      <span className="offer-card__art-glyph">🍴</span>
      <StoreImage url={storeUrl} />
    </div>
  );
};

/**
 * 紹介文（アピール説明）。カードでいちばん大きい文にする。
 * まだ届いていない間は、空白にせず薄い文と光の帯で「書いている」ことを見せる
 * （情報量をゼロにせず、期待だけを足す・速成版の `PitchBlock` と同じ考え）。
 */
const OfferPitch = ({ reason, source }: { reason: string; source?: PitchSource }) => {
  if (source === undefined) {
    return (
      <div aria-busy="true" className="offer-pitch offer-pitch--pending">
        <p className="offer-pitch__text">{reason === "" ? "この店のいいところを思い出しています" : reason}</p>
        <p className="offer-pitch__waiting">
          <span aria-hidden className="offer-pitch__sparkle">
            ✨
          </span>
          常連が紹介文を書いています…
        </p>
        <span aria-hidden className="offer-pitch__shimmer" />
      </div>
    );
  }
  return <p className={source === "persona" ? "offer-pitch offer-pitch--persona" : "offer-pitch"}>💡 {reason}</p>;
};

type ResultCardProps = {
  item: ResultItem;
  /** 上から順に出すための並びの番号（`rise-in` の遅れに使うだけ） */
  index: number;
  onReceive?: (item: ResultItem) => void;
  /** このカードが断られた1件のときだけ渡る。 */
  refusal?: ReceiveRefusal | null;
  onNextStep?: () => void;
  holding?: boolean;
};

const ResultCard = ({ item, index, onReceive, refusal = null, onNextStep, holding = false }: ResultCardProps) => (
  <li className="offer-card" data-testid={`result-${item.offerId}`} style={{ animationDelay: `${index * 70}ms` }}>
    <OfferArt storeName={item.storeName} storeUrl={item.storeUrl} />

    <p className="offer-card__meta">
      <span>徒歩{item.walkMinutes}分</span>
      <span aria-hidden>・</span>
      <span>
        1人あたり {yen(item.budgetMin)}〜{yen(item.budgetMax)}
      </span>
      <span aria-hidden>・</span>
      <span>{refusal?.partyMax ?? item.partyMax}名まで</span>
    </p>

    <h3 className="offer-card__name">{item.storeName}</h3>

    <OfferPitch reason={item.reason} source={item.pitchSource} />

    <div className="offer-card__coupon-block">
      <p className="offer-card__coupon-label">クーポン</p>
      {/* クーポン0個のときは欄を残して中を空にする（基準 4.14）。
          「案内はありません」の文は**この欄の外**に置く——受け入れ検査が欄そのものの空を見ている。 */}
      <ul className="offer-coupons" data-testid="coupon-list">
        {item.coupons.map((coupon, couponIndex) => (
          <li className="offer-coupon" key={`${coupon.name}-${couponIndex}`}>
            <span aria-hidden className="offer-coupon__mark">
              🎟️
            </span>
            <span className="offer-coupon__body">
              <span className="offer-coupon__name">{coupon.name}</span>
              {coupon.note === "" ? null : <span className="offer-coupon__note">（{coupon.note}）</span>}
            </span>
          </li>
        ))}
      </ul>
      {item.coupons.length === 0 ? <p className="offer-card__no-coupon">クーポンの案内はありません（席の確保はできます）</p> : null}
    </div>

    <button type="button" className="offer-card__cta" data-testid="btn-receive" disabled={holding} onClick={() => onReceive?.(item)}>
      この店に行く（20分間 席を確保）
    </button>

    {item.storeUrl === null ? null : (
      <a className="offer-card__link" href={item.storeUrl} target="_blank" rel="noreferrer">
        お店のホームページを見る
      </a>
    )}

    {refusal === null ? null : <RefusalNotice refusal={refusal} onNextStep={() => onNextStep?.()} />}
  </li>
);

/** 確保を持ったまま探しているときの案内（基準 8.10）。取り消せば受け取れることと、戻る入口。 */
const HoldNotice = ({ onBackToReservation }: { onBackToReservation?: () => void }) => (
  <p className="offer-hold" data-testid="result-hold-notice">
    今の確保を取り消すと受け取れます。
    <button type="button" data-testid="btn-back-to-reservation" onClick={() => onBackToReservation?.()}>
      確保中の表示へ戻る
    </button>
  </p>
);

export const ResultList = ({ items, onReceive, refusal = null, onNextStep, holding = false, onBackToReservation }: ResultListProps) => (
  <section className="offer-list" data-testid="result-list">
    {/* 描かれた時に1回だけ出る宝くじの札（探し直すたびにこの部品ごと作り直されるので、
        出す・消すの状態を入れ物へ増やさずに済む）。 */}
    <OfferReveal count={items.length} />

    <h2 className="offer-list__head">
      今入れるお店
      {items.length === 0 ? null : <span className="offer-list__count">{items.length}件</span>}
    </h2>

    {holding ? <HoldNotice onBackToReservation={onBackToReservation} /> : null}
    {items.length === 0 ? (
      <EmptyResult />
    ) : (
      <ul className="offer-cards">
        {items.map((item, index) => (
          <ResultCard
            key={item.offerId}
            item={item}
            index={index}
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
