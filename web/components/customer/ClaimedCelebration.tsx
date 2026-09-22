"use client";

// 受け取りが通った瞬間に前面へ出す1枚（2026-09-22 の本人の指摘）。
//
//   「受け取った瞬間にファンファーレみたいなエフェクトが欲しい」
//   「オファーを受け取って確定したら別画面に遷移してオファー承諾の楽しい演出をつけ、オファーを前面に出し、
//     …それが厳しいならすぐに経路情報を保ったままGoogleマップを起動できるようにする」
//   「受け取ったオファーを前面に出してほしい。他の登録フォームやオファー一覧が先に来ると飲食店に見せにくい」
//
// **確保中の表示（`ReservationView`）を消さずに、その上に重ねる**。消さない理由は2つ:
//   1. 閉じたあとに戻る先がそのまま在る（別の画面へ本当に移ってしまうと、戻る道を自分で作ることになる）。
//   2. 確保中の表示は「店頭で見せる画面」として要件9が中身を決めており（基準 9.1・9.2・9.13）、
//      そこに手を入れずに演出だけを足せる。
//
// 経路は Google マップのリンクで開く（地図の画面を埋め込むと鍵が画面側に要る——ここには置かない）。
// 出発地は分かっていれば渡す（渡さなければマップ側が現在地から引く）。
//
// 置き方（位置・重なり）だけを style で持ち、色は持たない——色は globals.css の変数が正本
// （要件32の基準 32.3・構造の検査が .tsx に色の値が無いことを見張る）。見た目の仕上げは
// `claimed-celebration` の class に当てる。

import { useEffect, useMemo } from "react";
import { playNotifyBeep } from "../store/beep";
import { CouponPickNote } from "./CouponPickNote";
import type { ReservationDto } from "./home";

/** 紙吹雪の数（多すぎると読みたい番号が埋まる）。 */
const CONFETTI_COUNT = 18;
const CONFETTI_MARKS = ["🎊", "✨", "🎉", "⭐"];

/**
 * 紙吹雪。位置と間の取り方だけを持つ（落ちる動きは CSS の `confetti-piece` に当てる。
 * 動きが無い環境では、上の方に飾りが並ぶだけで読み上げには乗らない）。
 */
const Confetti = () => {
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, index) => ({
        key: index,
        left: `${Math.round((index / CONFETTI_COUNT) * 100)}%`,
        delay: `${(index % 6) * 90}ms`,
        mark: CONFETTI_MARKS[index % CONFETTI_MARKS.length],
      })),
    [],
  );
  return (
    <div aria-hidden className="confetti" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {pieces.map((piece) => (
        <span key={piece.key} className="confetti-piece" style={{ position: "absolute", top: 0, left: piece.left, animationDelay: piece.delay }}>
          {piece.mark}
        </span>
      ))}
    </div>
  );
};

/**
 * 経路を開くリンク（店名と住所で引く。出発地が分かっていれば渡す）。
 *
 * ⚠️ **出発地を渡さないと、マップは端末の現在地から引く**（2026-09-22 の本人の指摘——
 * 現在地と違う場所を入れて探したのに、経路の開始地点が現在地になり、徒歩7時間と出た）。
 * 探した起点は座標のことも、客が打った場所の文字のこともある。マップの `origin` は
 * **どちらの形でも受ける**ので、そのまま渡す。
 */
const routeHref = (reservation: ReservationDto, from: RouteOrigin | null): string | null => {
  const destination = [reservation.storeName, reservation.storeAddress].filter((part) => part !== "").join(" ");
  if (destination === "") return null;
  const params = new URLSearchParams({ api: "1", destination, travelmode: "walking" });
  if (from !== null) params.set("origin", "place" in from ? from.place : `${from.lat},${from.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

/** 経路の出発地。探したときの起点をそのまま使う（座標か、客が打った場所の文字）。 */
export type RouteOrigin = { lat: number; lng: number } | { place: string };

type ClaimedCelebrationProps = {
  reservation: ReservationDto;
  /** 分かっている出発地（無ければマップ側が現在地から引く）。 */
  from?: RouteOrigin | null;
  onClose: () => void;
};

export const ClaimedCelebration = ({ reservation, from = null, onClose }: ClaimedCelebrationProps) => {
  // 音は飾り（鳴らせない端末では黙って何もしない・`components/store/beep.ts` の注）。
  // 店の画面と同じ2音を使う——同じ知らせに2つの音を作らない。
  useEffect(() => {
    playNotifyBeep();
  }, []);

  const href = routeHref(reservation, from);

  return (
    <div
      className="claimed-celebration"
      data-testid="claimed-celebration"
      role="dialog"
      aria-label="受け取り完了"
      style={{ position: "fixed", inset: 0, zIndex: 50, overflowY: "auto", background: "var(--color-background)" }}
    >
      <Confetti />
      <div className="claimed-celebration-inner" style={{ position: "relative" }}>
        <p className="claimed-eyebrow">席を確保しました</p>
        <h2 className="claimed-title">
          <span aria-hidden className="claimed-mark">
            🎉
          </span>
          受け取りました！
        </h2>

        {/* 番号を主役に置く（2026-09-22 本人の指摘「8桁番号を目立たせてほしい。これを一番に見せたい」）。
            店頭で見せる半券に見立てて、白い札の上に大きく出す——橙の地の上で番号だけが抜ける。 */}
        <div className="claimed-ticket">
          <p className="claimed-ticket__label">確保番号</p>
          <p className="claimed-ticket__code" data-testid="claimed-code">
            {reservation.code}
          </p>
          <p className="claimed-ticket__hint">お店でこの番号を見せてください</p>
          <dl className="claimed-ticket__facts">
            <div>
              <dt>店</dt>
              <dd>{reservation.storeName}</dd>
            </div>
            <div>
              <dt>場所</dt>
              <dd>{reservation.storeAddress}</dd>
            </div>
            <div>
              <dt>人数</dt>
              <dd>{reservation.party}名</dd>
            </div>
          </dl>
        </div>

        {reservation.coupons.length === 0 ? null : (
          <div className="claimed-coupons">
            <p className="claimed-coupons__label">使えるクーポン</p>
            {/* 2026-09-22 の本人の指摘2件——「カードで分離されていない」「クーポン内容が白飛びしてます」。
                札の形は一覧・確保中と揃え、**橙の地の上で読める配色**を `.claimed-coupons` の中だけで当てる。 */}
            <ul className="coupon-list offer-coupons">
              {reservation.coupons.map((coupon, index) => (
                <li className="offer-coupon" key={`${coupon.name}-${index}`}>
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
            <CouponPickNote count={reservation.coupons.length} />
          </div>
        )}

        {href === null ? null : (
          <a className="claimed-route" data-testid="link-route" href={href} target="_blank" rel="noreferrer">
            Googleマップで経路を開く
          </a>
        )}
        <button type="button" data-testid="btn-close-celebration" onClick={onClose}>
          確保の画面へ
        </button>
      </div>
    </div>
  );
};

export default ClaimedCelebration;
