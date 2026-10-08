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
    <span className="store-badge store-badge--live" data-testid="offer-status">
      <span className="store-badge__dot" />
      配信中
    </span>
  ) : (
    <span className="store-badge store-badge--full" data-testid="offer-status">
      満席（いまは客に出ていません）
    </span>
  );

/**
 * 「受付を締める」（2026-09-25 監査の指摘 店-09: 残りを0にする操作を一押しで）。数を変えるシートの中に置く。
 * ⚠️ 店が打つ欄は置かない（基準 18.15）。締めるのは「残りの募集を減らす」の入口を残りの数で1回呼ぶだけ
 *    （足せばまた出る・取り返しがつくので確かめは挟まない）。
 */
export const CloseIntake = ({ remaining, onCloseIntake, sending }: { remaining: number; onCloseIntake: () => void; sending: boolean }) => (
  <div className="store-link-row">
    <p className="store-note">残りを0にして、これ以上受け取られないようにします（配信数を足せばまた出ます）。</p>
    <button type="button" className="store-btn store-btn--text" data-testid="btn-close-intake" disabled={remaining === 0 || sending} onClick={onCloseIntake}>
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
