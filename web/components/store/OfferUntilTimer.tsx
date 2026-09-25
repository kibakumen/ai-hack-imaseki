"use client";

// 公開中のカードの「終了タイマー」（何時まで）。2026-09-25 監査の指摘 店-05・店-06 で畳んだ。
//
// 本人の第2回の指摘は「終了時刻は優先順位が低いので、最初は表示せず、隅のボタンを押したときに入力欄が現れる」。
// それまでは公開中のカードで時刻の欄が常に出ていて、スマホの幅で「更新する」を画面の外へ押し出していた。
// 今は1行（今の終わりの時刻と、変える先）だけを出し、欄はボタンの裏に畳む。
//
// ⚠️ 受け入れ検査が掴む `<form data-testid="form-until">` と、その中の欄・ボタンは DOM に残す（畳むのは CSS だけ）。
//    断りの文は畳む箱の**外**（フォームの中）に出し、断られたら箱を開く——隠れた欄に文が付かないように。
// ⚠️ 欄の横に**公開した時刻と最長の時刻**を出す（基準 19.11 の後半）——時分だけの入力では、公開した時刻より前の
//    時分が翌日と読まれることを見分けられないので、範囲を目で確かめられるようにする。

import { useState, type FormEvent } from "react";
import type { ApiFailure } from "../../lib/client/api";
import { FieldMessage, FormMessage, fieldAria, type RefusalContext } from "../ui/InputRefusal";
import { timeInJst } from "../ui/jstTime";

type Props = {
  offer: { untilAt: string; untilSet: boolean; publishedAt: string; latestUntil: string };
  /** 打った時刻（空欄は変えていない） */
  value: string;
  changed: boolean;
  failure: ApiFailure | null;
  onChange: (next: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export const OfferUntilTimer = ({ offer, value, changed, failure, onChange, onSubmit }: Props) => {
  const [open, setOpen] = useState(false);
  const nowUntil = timeInJst(offer.untilAt);
  const latestUntil = timeInJst(offer.latestUntil);
  // `until_in_past` は入れた時刻を、`until_over_window` は最長の時刻を文に使う（domain/texts）。
  const ctx: RefusalContext = { field: "何時まで", input: value, latest: latestUntil };
  const expanded = open || failure !== null;

  return (
    <form className={changed ? "store-tune__form store-timer store-tune__dial--changed" : "store-tune__form store-timer"} data-testid="form-until" noValidate onSubmit={onSubmit}>
      <div className="store-row">
        <p className="store-timer__now">
          <span className="store-label">終了</span>
          <span>{offer.untilSet ? `${nowUntil} に終了` : `自動で ${nowUntil} に終了`}</span>
          {changed ? (
            <>
              <span className="store-tune__arrow" aria-hidden="true">
                →
              </span>
              <strong>{value} に終了</strong>
            </>
          ) : null}
        </p>
        <button
          type="button"
          className="store-btn store-btn--quiet store-btn--small"
          aria-expanded={expanded}
          aria-controls="offer-until-box"
          onClick={() => setOpen((current) => !current)}
        >
          {expanded ? "終了タイマーを閉じる" : offer.untilSet ? "終了タイマーを変える" : "終了タイマーを設定"}
        </button>
      </div>
      <div id="offer-until-box" className={expanded ? "store-collapse" : "store-collapse store-collapse--closed"}>
        <label className="store-label" htmlFor="offer-until">
          何時に終わるか
        </label>
        <input id="offer-until" data-testid="field-until" className="store-tune__time" type="time" value={value} onChange={(event) => onChange(event.target.value)} {...fieldAria("until", failure, "offer-until")} />
        <p className="store-note">
          {timeInJst(offer.publishedAt)} 公開・最長 {latestUntil} まで
        </p>
      </div>
      <button type="submit" className="store-sr-only store-sr-only--focusable" data-testid="btn-until">
        何時までを変える
      </button>
      <FieldMessage inputId="offer-until" name="until" failure={failure} ctx={ctx} />
      <FormMessage failure={failure} fieldNames={["until"]} ctx={ctx} />
    </form>
  );
};

export default OfferUntilTimer;
