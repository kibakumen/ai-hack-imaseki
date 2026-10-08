"use client";

// オファーを公開するフォーム（要件17の基準 17.1〜17.8・17.17〜17.21・17.23）。
// 受付時間の始まりをずらす欄と、曜日の繰り返しの欄は置かない（基準 17.7・17.8）。
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる
// （設計書「入力の誤りの出し方」の規則5）。断られてもフォームのまま、入れた内容は消さない。
//
// 見た目は 2026-09-21 の本人の指摘を入れた（速成版 sprint/app/store が基準）:
//   - 「募集する組数」は**配信数**と呼ぶ
//   - 配信数と何名までは**ダイヤル**で選ぶ（打った文字は WheelPicker の裏の欄がそのまま持つ）
//   - **終了時刻は初めは畳んでおく**（多くの店は「ずっと受け付ける」ので、毎回は要らない）。
//     2026-09-25 監査の指摘 店-05 の案A で「何時まで」を**入れなくても公開できる**ようにした（入れなければ公開から
//     12時間で自動で終わる）ので、本人の指摘どおり**いつも畳んでおく**「終了タイマー」になった。
//     ⚠️ 畳むのは見た目だけ——欄は DOM に残したまま隠す。入口が「何時まで」を断ったときは開く
//   - クーポンは**チェックの付いたカードを横に並べる**
//
// 2026-10-08 本人選択「案C 片手の親指」の論点3（空欄のダイヤル）で並べ直した（送るものと断りの出し方は変えていない）:
//   - いちばん上に「客にはこう出ます」の1行（決めていない数は破線の枠に「—」）
//   - 空欄のダイヤルは破線の枠に「—」と黄の「未選択」。よく使う数のチップ（1〜6）を1回押せば決まる
//   - 「終了タイマー」と「公開する」は画面の下に貼り付く帯（親指の届く所）。公開のボタンは、決めていない数が残っていれば
//     「あと N つ決めると公開できます」、決まれば「公開する（3組・4名まで）」と中身を復唱する。
//     ⚠️ 押せなくはしない——決めていなくても押せば、これまでどおり入口の断りが欄の下に出る

import { useEffect, useState, type FormEvent } from "react";
import { callApi, isFailure, type ApiFailure } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { WheelPicker } from "./WheelPicker";
import { SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";
import { TERMS } from "../../lib/domain/texts";

export type PublishFormCoupon = { id: string; name: string; note: string };
export type PublishFormPrefill = { couponIds: string[]; capacity: number | null; partyMax: number | null; until: string | null };

type Props = {
  coupons: PublishFormCoupon[];
  prefill: PublishFormPrefill;
  /** 公開できたら、店のホームを取り直してカードに切り替える */
  onPublished: () => void;
};

const FIELD_NAMES = ["capacity", "partyMax", "until"];
/** 足りない店の情報で断られたときの行き先（基準 17.11 の案内） */
const PROFILE_LINKS = { profile_incomplete: { href: "/store/profile", label: `${TERMS.storeProfile}を開く` } };
/** 「何時まで」に関わる断りの語。返ってきたら畳んだ欄を開く */
const UNTIL_KINDS = ["until_in_past", "until_over_window"];
const CAPACITY_LABEL = "配信数";
const PARTY_MAX_LABEL = "何名まで";

const numberText = (value: number | null): string => (value === null ? "" : String(value));
const toNumberOrNull = (text: string): number | null => (text.trim() === "" ? null : Number(text));

/** 「何時まで」に帰せる断りが返ったか（畳んである欄に文が付くのを避けるために開く） */
const untilRefused = (failure: ApiFailure | null): boolean =>
  (failure?.error?.fields ?? []).some((f) => f.name === "until") || UNTIL_KINDS.includes(failure?.error?.kind ?? "");

/**
 * 終了タイマー（「何時まで」）の欄と、その開け閉め（2026-09-25 監査の指摘 店-05 の案A）。
 *
 * 本人の指摘は「公開終了時間は未入力でも公開可。忙しくて忘れそうなときのために、終了タイマーとして入れられる
 * 温度感」。そこで**いつも畳んでおき**、入れていなければ「公開から12時間で自動で終わる」と書き、入れていれば
 * その時刻を横に出す（隠れた値のまま送らせない）。
 *
 * ⚠️ 畳んでいる間も**欄は DOM に残す**（CSS で隠すだけ・受け入れ検査が欄に打つ）。
 */
const UntilField = ({
  value,
  open,
  onChange,
  failure,
}: {
  value: string;
  open: boolean;
  onChange: (next: string) => void;
  /** 断りが返っていれば、欄が文を指す（横断-05） */
  failure: ApiFailure | null;
}) => (
  <div id="publish-until-box" className={open ? "store-collapse store-timer" : "store-collapse store-collapse--closed store-timer"}>
    <div className="store-field">
      <label htmlFor="publish-until">何時に終わるか（公開から12時間以内）</label>
      <div className="store-inline">
        <input
          id="publish-until"
          data-testid="field-until"
          type="time"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...fieldAria("until", failure, "publish-until")}
        />
        {value === "" ? null : (
          <button type="button" className="store-btn store-btn--quiet" onClick={() => onChange("")}>
            タイマーを外す
          </button>
        )}
      </div>
    </div>
  </div>
);

/** 「客にはこう出ます」——決めた数がその場で埋まる1行と、クーポン・終了の説明 */
const PublishPreview = ({ capacity, partyMax, until, couponNames }: { capacity: string; partyMax: string; until: string; couponNames: string[] }) => {
  const slot = (value: string, before: string | null, after: string) => (
    <span className={value.trim() === "" ? "store-slot store-slot--empty" : "store-slot"}>
      {before ? <span>{before}</span> : null}
      <b>{value.trim() === "" ? "—" : value}</b>
      <span>{after}</span>
    </span>
  );
  return (
    <div className="store-preview">
      <p className="store-preview__title">客にはこう出ます</p>
      <p className="store-preview__line">
        {slot(capacity, "空き", "組")}
        {slot(partyMax, null, "名まで")}
      </p>
      <p className="store-preview__foot">
        {couponNames.length === 0 ? "クーポンなし" : `クーポン ${couponNames.length}枚（${couponNames.join("・")}）`}／
        {until === "" ? "終了タイマーなし（公開から12時間で自動で終わります）" : `終了タイマー ${until} に終わります`}
      </p>
    </div>
  );
};

/** 公開のボタンの文。決めていない数が残っていれば残りの数を言い、決まれば中身を復唱する */
const publishLabelOf = (capacity: string, partyMax: string): string => {
  const missing = [capacity, partyMax].filter((value) => value.trim() === "").length;
  return missing > 0 ? `あと${missing}つ決めると公開できます` : `公開する（${capacity}組・${partyMax}名まで）`;
};

/** よく使う数（案C の論点3: 1回押せば決まるチップ） */
const QUICK_PICKS = [1, 2, 3, 4, 5, 6] as const;

/**
 * 見せるクーポンの選び方——**チェックボックスつきの札**（2026-09-22 の本人の指摘「クーポンカードは
 * チェックボックスカードにして選択状態がわかりやすく」）。選ばれた札は縁と地が橙に変わり、左の四角に
 * チェックが入る。客の画面のクーポンの札（`me.css` の `.offer-coupon`・点線の縁）と同じ語彙。
 * ⚠️ 本物の `<input type="checkbox">` は DOM に残す（受け入れ検査が `coupon-<id>` で押す・
 *    読み上げとキーボードもこちらに答える）。目に見えるチェックは CSS が描く。
 */
const CouponChoices = ({
  coupons,
  selected,
  onToggle,
}: {
  coupons: PublishFormCoupon[];
  selected: string[];
  onToggle: (id: string) => void;
}) => (
  <fieldset className="store-field store-coupon-set" data-testid="coupon-list">
    <legend>見せるクーポン（押して選ぶ・0個でもよい）</legend>
    {coupons.length === 0 ? <p className="store-empty">クーポンはまだありません。</p> : null}
    <div className="store-coupons store-coupons--wrap">
      {coupons.map((coupon) => {
        const on = selected.includes(coupon.id);
        return (
          <label className={on ? "store-coupon store-coupon--on" : "store-coupon"} key={coupon.id} htmlFor={`publish-coupon-${coupon.id}`}>
            <input
              id={`publish-coupon-${coupon.id}`}
              data-testid={`coupon-${coupon.id}`}
              className="store-coupon__input"
              type="checkbox"
              checked={on}
              onChange={() => onToggle(coupon.id)}
            />
            <span className="store-coupon__check" aria-hidden="true">
              {on ? "✓" : ""}
            </span>
            <span className="store-coupon__body">
              <span className="store-coupon__name">{coupon.name}</span>
              {coupon.note === "" ? null : <span className="store-coupon__note">{coupon.note}</span>}
            </span>
          </label>
        );
      })}
    </div>
    {/* 入れ忘れに気づかせる表示（要件17の基準 17.23）。チェックが0個の間だけ出す */}
    {selected.length === 0 ? <p className="store-note">クーポンを見せないオファーとして公開されます。</p> : null}
  </fieldset>
);

export const PublishForm = ({ coupons, prefill, onPublished }: Props) => {
  const [couponIds, setCouponIds] = useState<string[]>(prefill.couponIds);
  const [capacity, setCapacity] = useState(numberText(prefill.capacity));
  const [partyMax, setPartyMax] = useState(numberText(prefill.partyMax));
  const [until, setUntil] = useState(prefill.until ?? "");
  // 終了タイマーはいつも畳んでおく（入れなくても公開できる・店-05）。断られたら開く
  const [untilOpen, setUntilOpen] = useState(false);
  // 帯の「終了タイマー」で開いたら、欄を画面の中へ寄せる（帯は画面の下、欄はフォームの途中にある）
  useEffect(() => {
    if (untilOpen) document.getElementById("publish-until-box")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [untilOpen]);
  // 送っている間は「公開する」を止める（2026-09-25 監査の指摘 横断-03）
  const publish = useSubmit();
  const failure = publish.failure;

  const toggleCoupon = (id: string) => {
    setCouponIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await publish.run(() =>
      callApi("POST /api/store/offers", {
        body: {
          couponIds,
          capacity: toNumberOrNull(capacity),
          partyMax: toNumberOrNull(partyMax),
          // 空欄は載せない＝終了タイマーなし（公開から12時間で自動で終わる・店-05）
          until: until === "" ? undefined : until,
        },
      }),
    );
    if (result === null) return;
    if (isFailure(result)) {
      // 画面は移らず、入れた内容もそのまま（設計書「入力の誤りの出し方」の規則3）。
      if (untilRefused(result)) setUntilOpen(true);
      return;
    }
    onPublished();
  };

  const couponNames = coupons.filter((coupon) => couponIds.includes(coupon.id)).map((coupon) => coupon.name);

  return (
    <form
      className="store-publish"
      data-testid="form-publish"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="store-publish__head">
        <h2>オファーを公開する</h2>
        <span className="store-badge store-badge--off">停止中</span>
      </div>

      <PublishPreview capacity={capacity} partyMax={partyMax} until={until} couponNames={couponNames} />

      <div className="store-dials">
        <WheelPicker
          testId="field-capacity"
          inputId="publish-capacity"
          label={CAPACITY_LABEL}
          hint="何組まで受け取れるか"
          unit="組"
          min={OFFER_CAPACITY_MIN}
          max={OFFER_CAPACITY_MAX}
          value={capacity}
          onChange={setCapacity}
          picks={QUICK_PICKS}
          aria={fieldAria("capacity", failure, "publish-capacity")}
        />
        <WheelPicker
          testId="field-partyMax"
          inputId="publish-party-max"
          label={PARTY_MAX_LABEL}
          hint="1組あたりの人数の上限"
          unit="名"
          min={OFFER_PARTY_MAX_MIN}
          max={OFFER_PARTY_MAX_MAX}
          value={partyMax}
          onChange={setPartyMax}
          picks={QUICK_PICKS}
          aria={fieldAria("partyMax", failure, "publish-party-max")}
        />
      </div>
      <FieldMessage inputId="publish-capacity" name="capacity" failure={failure} ctx={{ field: CAPACITY_LABEL, min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX }} />
      <FieldMessage inputId="publish-party-max" name="partyMax" failure={failure} ctx={{ field: PARTY_MAX_LABEL, min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX }} />

      <UntilField value={until} open={untilOpen} onChange={setUntil} failure={failure} />
      <FieldMessage inputId="publish-until" name="until" failure={failure} ctx={{ field: "何時まで" }} />

      <CouponChoices coupons={coupons} selected={couponIds} onToggle={toggleCoupon} />

      {/* 画面の下に貼り付く帯（親指の届く所）。断りの文は帯の中のボタンの真上に出す（押した所から見える） */}
      <div className="store-dock">
        <FormMessage failure={failure} fieldNames={FIELD_NAMES} links={PROFILE_LINKS} />
        <div className="store-dock__row">
          <button
            type="button"
            className="store-btn store-btn--tonal store-dock__side"
            aria-expanded={untilOpen}
            aria-controls="publish-until-box"
            onClick={() => setUntilOpen((open) => !open)}
          >
            {until === "" ? "終了タイマー" : `終了タイマー ${until}`}
          </button>
          <SubmitButton type="submit" className="store-btn store-btn--primary store-dock__main" data-testid="btn-publish" busy={publish.busy}>
            {publishLabelOf(capacity, partyMax)}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
};

export default PublishForm;
