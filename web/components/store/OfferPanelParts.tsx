"use client";

// 公開中のカード（OfferPanel）の小さな部品。値は持たず、渡されたものを描くだけ。

import type { FieldAria } from "../ui/InputRefusal";
import type { OfferAction } from "./offerChange";

export type OfferPanelCoupon = { id: string; name: string; note: string };

/**
 * 目に出さない1操作ぶんの欄とボタン（キーボード・読み上げ・受け入れ検査の受け口）。
 * Tab で焦点が入ったら見せる（`store-sr-only--focusable`・2026-09-25 監査の指摘 横断-06。見えないままだと、
 * 焦点が画面から消えたまま数字を打つことになった）。
 */
export const HiddenControl = ({
  action,
  inputId,
  testId,
  label,
  button,
  type,
  min,
  max,
  value,
  onChange,
  aria = {},
}: {
  action: OfferAction;
  inputId: string;
  testId: string;
  label: string;
  button: string;
  type: "number" | "time";
  min?: number;
  max?: number;
  value: string;
  onChange: (next: string) => void;
  /** 断りとの結びつき（components/ui/InputRefusal の fieldAria・横断-05） */
  aria?: FieldAria;
}) => (
  <div className="store-sr-only store-sr-only--focusable">
    <label htmlFor={inputId}>{label}</label>
    <input
      id={inputId}
      data-testid={testId}
      type={type}
      inputMode={type === "number" ? "numeric" : undefined}
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...aria}
    />
    <button type="submit" data-testid={`btn-${action}`}>
      {button}
    </button>
  </div>
);

/** 今の値と次の値（変えたときだけ矢印つき）。 */
export const NextValue = ({ now, next, unit }: { now: string; next: string | null; unit: string }) => (
  <p className={next === null ? "store-tune__delta" : "store-tune__delta store-tune__delta--changed"}>
    <span>
      今 {now}
      {unit}
    </span>
    {next === null ? null : (
      <>
        <span className="store-tune__arrow" aria-hidden="true">
          →
        </span>
        <strong>
          {next}
          {unit}
        </strong>
      </>
    )}
  </p>
);

/**
 * 配信中か満席かのバッジ（2026-09-25 監査の指摘 店-16）。
 * 残りが0だと客の取得の結果には出ない（受け取れる状態でない・要件18の基準 18.12）のに、それまでは常に点滅つきの
 * 「配信中」を出していて、さらに席が空いても配信数を足すべきだと気づけなかった。
 */
export const OfferStatusBadge = ({ remaining }: { remaining: number }) =>
  remaining > 0 ? (
    <span className="store-badge" data-testid="offer-status">
      <span className="store-badge__dot" />
      配信中
    </span>
  ) : (
    <span className="store-badge store-badge--full" data-testid="offer-status">
      満席（いまは客に出ていません）
    </span>
  );

/**
 * 残り（店がいちばん見る数）と「受付を締める」（2026-09-25 監査の指摘 店-09: 残りを0にする操作を一押しで）。
 * ⚠️ `offer-remaining` の名前で出す——店が打つ欄は置かない（基準 18.15）。締めるのは「残りの募集を減らす」の入口を
 *    残りの数で1回呼ぶだけ（足せばまた出る・取り返しがつくので確かめは挟まない）。
 */
export const Remaining = ({ remaining, onCloseIntake, sending }: { remaining: number; onCloseIntake: () => void; sending: boolean }) => (
  <div className="store-remaining-row">
    <div className="store-remaining" data-testid="offer-remaining">
      <span className="store-remaining__label">残り</span>
      <span className="store-remaining__value">
        {remaining}
        <span className="store-remaining__unit">組</span>
      </span>
    </div>
    <button
      type="button"
      className="store-btn store-btn--quiet store-btn--small"
      data-testid="btn-close-intake"
      title="残りを0にして、これ以上受け取られないようにします（配信数を足せばまた出ます）"
      disabled={remaining === 0 || sending}
      onClick={onCloseIntake}
    >
      受付を締める
    </button>
  </div>
);

/**
 * 見せるクーポン——登録してある全部を**折り返しの横並び**の札にして、押して選ぶ（本人の第2回の指摘「クーポンの
 * カードは横いっぱいにいらない。表示名を隠さない程度の横幅で横並びに」・店-06）。
 * 選び直しは「更新する」で差し替えの入口へ送る（公開は止まらない・不具合-03）。
 * 札は `<button role="checkbox" aria-checked>`（押せて・選択状態が見える・読み上げにも答える）。
 */
export const CouponToggles = ({
  coupons,
  selected,
  changed,
  onToggle,
}: {
  coupons: OfferPanelCoupon[];
  selected: string[];
  changed: boolean;
  onToggle: (id: string) => void;
}) => (
  <div className={changed ? "store-tune__coupons store-tune__dial--changed" : "store-tune__coupons"} role="group" aria-labelledby="offer-coupons-label">
    <div className="store-tune__coupons-head">
      <p className="store-label" id="offer-coupons-label">
        見せるクーポン
      </p>
      <p className="store-note">{changed ? "選び直しは「更新する」で送ります（公開は止まりません）" : "押して選ぶ・0個でもよい"}</p>
    </div>
    {coupons.length === 0 ? (
      <p className="store-empty store-empty--coupons">
        クーポンの登録はありません。
        <a href="/store/coupons">クーポンを作る</a>
      </p>
    ) : (
      <div className="store-coupons store-coupons--wrap">
        {coupons.map((coupon) => {
          const on = selected.includes(coupon.id);
          return (
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              className={on ? "store-coupon store-coupon--toggle store-coupon--on" : "store-coupon store-coupon--toggle"}
              data-testid={`offer-coupon-${coupon.id}`}
              key={coupon.id}
              onClick={() => onToggle(coupon.id)}
            >
              <span className="store-coupon__check" aria-hidden="true">
                {on ? "✓" : ""}
              </span>
              <span className="store-coupon__body">
                <span className="store-coupon__name">{coupon.name}</span>
                {coupon.note === "" ? null : <span className="store-coupon__note">{coupon.note}</span>}
              </span>
            </button>
          );
        })}
      </div>
    )}
    {coupons.length > 0 && selected.length === 0 ? <p className="store-note">クーポンを見せないオファーとして公開しています。</p> : null}
  </div>
);

/**
 * 「公開を止める」の確かめ（2026-09-25 監査の指摘 店-03 の案A）。
 * 止めたオファーは再開できず（要件17の基準 17.15）、止めても確保は取り消されない（基準 17.16）。それまでは確かめ無しの
 * 1回押しで、満席で止めた店が「向かっている客も止まった」と思い込んで席を空けてしまいえた。同じ画面の完了・取り消しと
 * 同じ形（`.store-confirm`）で1段挟み、向かっている組数を添える。
 */
export const StopConfirm = ({ arriving, onConfirm, onCancel }: { arriving: number; onConfirm: () => void; onCancel: () => void }) => (
  <div className="store-confirm" role="dialog" aria-label="公開を止める確かめ" data-testid="confirm-stop">
    <p>
      <strong>止めると、このオファーは再開できません。</strong>
    </p>
    <p>{arriving > 0 ? `向かっている ${arriving} 組の確保はそのまま残り、お客さまは来店します。` : "いま向かっているお客さまはいません。"}</p>
    <p className="store-note">また出すときは、今の内容が入った公開のフォームからすぐに出し直せます。</p>
    <div className="store-confirm__buttons">
      <button type="button" className="store-btn store-btn--danger" data-testid="btn-confirm-stop" onClick={onConfirm}>
        止める
      </button>
      <button type="button" className="store-btn store-btn--quiet" onClick={onCancel}>
        やめる
      </button>
    </div>
  </div>
);
