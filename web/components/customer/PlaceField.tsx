"use client";

// 場所の欄（「現在地を使う」ボタン・取れたかどうかの案内・打っている最中の候補）。`FetchForm` から
// 切り出した（2026-09-25）。現在地の状態は `useHereLocation` が持ち、ここは見せ方と候補の選び方だけを持つ。
//
// 本人の指摘（2026-09-22）から来ている決め:
//   - 「現在地を使う」はリンクではなくボタン。横（下）に取れた場所か取れなかった旨を出す
//   - 欄の中身が**現在地から離れたら**「現在地を使う」を強調する（いつでも戻せることを見せる）
//   - 打っている最中に候補を出し、タップで選べる（↑↓ と Enter で選び、Esc で閉じる）
// 2026-09-25 監査の指摘で足した決め:
//   - 安全-18: 押す前に、押すと何がどこへ送られるかを1行で添え、送信先の一覧（/privacy）へつなぐ
//   - 客-09: 取れなかった・許可を断られた間は、欄の説明を「駅名や住所を入れてください」に替える
//   - 客-10: 地名を問い合わせている間は失敗の文を出さない
//   - 設計-20: 候補と現在地の地名は Google の地図サービスから来る。地図を出さずに見せるので、同じ入れ物の中に
//     「Google Maps」の帰属の表示を置く（Geocoding API Policies の Attribution。場所が狭いときは文字でよい）

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import type { ApiFailure } from "../../lib/client/api";
import { usePlaceSuggestions } from "../../lib/client/placeSuggest";
import { PLACE_MAX } from "../../lib/schemas/limits";
import { FieldMessage, fieldAria } from "../ui/InputRefusal";
import type { LocateState } from "./useHereLocation";

/**
 * 場所の欄の直下に出す、規則の断りの語（理由だけでは何が起きたか伝わらないもの）。
 * `location_required` は現在地が取れなかった（`client/geolocation` が返す・基準 3.7・3.8）、
 * `place_unresolved` は入れた文字が位置に直せなかった（基準 3.4〜3.6）。
 * 語から文を選ぶのは部品 `InputRefusal` の仕事で、ここは項目との結びつきだけを渡す。
 */
const PLACE_KINDS = ["location_required", "place_unresolved"];
const SUGGEST_LIST_ID = "fetch-place-suggestions";

/** Google の地図サービスの帰属の表示（文字の形・設計-20）。訳させない（名前なので） */
const GOOGLE_ATTRIBUTION = "Google Maps";

/** 現在地の案内の文（欄の直下の断りとは別物——押す前の案内なので責めない）。 */
const locateText = (locate: LocateState, hereLabel: string | null): string | null => {
  if (locate === "locating") return "現在地を取得しています…";
  if (locate === "resolving") return "現在地の地名を調べています…";
  if (locate === "located") return hereLabel !== null ? `現在地: ${hereLabel}` : "現在地は取れました（地名にはできませんでした）。そのまま探せます。";
  if (locate === "failed") return "現在地が取れませんでした。駅名や住所を入れてください。";
  if (locate === "denied") return "位置情報の利用が許可されていません。駅名や住所を入れてください。";
  return null;
};

type PlaceFieldProps = {
  place: string;
  onPlaceChange: (place: string) => void;
  locate: LocateState;
  hereLabel: string | null;
  /** 欄の中身が現在地から離れたか（離れている間は「現在地を使う」を強調する） */
  away: boolean;
  /** 「現在地を使う」を押したとき */
  onUseLocation: () => void;
  failure: ApiFailure | null;
};

export const PlaceField = ({ place, onPlaceChange, locate, hereLabel, away, onUseLocation, failure }: PlaceFieldProps) => {
  // 候補。`typing` は客が自分で打っている最中か（現在地の地名を自動で入れた直後や候補を選んだ直後は
  // false＝聞きに行かない）。`suggestOpen` は一覧を見せているか、`activeIndex` はキーボードで選んでいる行。
  const [typing, setTyping] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = usePlaceSuggestions(place, typing);
  const listVisible = suggestOpen && suggestions.length > 0;
  const unavailable = locate === "failed" || locate === "denied";

  const closeList = () => {
    setSuggestOpen(false);
    setActiveIndex(-1);
  };

  /** 候補を1つ選ぶ: 欄にその文字を入れ、一覧を閉じる（選んだ文字を打ち直すまで、また聞きに行かない）。 */
  const chooseSuggestion = (text: string) => {
    onPlaceChange(text);
    setTyping(false);
    closeList();
  };

  /**
   * 一覧が出ている間だけ ↑↓・Enter・Esc を取る。行を選ばずに Enter を押したときは一覧を閉じて、
   * そのまま「今すぐ探す」へ通す（既定の動きは止めない）。
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!listVisible) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0 && activeIndex < suggestions.length) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeList();
    } else if (event.key === "Enter") {
      closeList();
    }
  };

  return (
    <div className="fetch-place">
      <label htmlFor="fetch-place">いる場所</label>
      <button
        type="button"
        data-testid="btn-use-location"
        className={away ? "use-location use-location-away" : "use-location"}
        disabled={locate === "locating" || locate === "resolving"}
        onClick={() => {
          setTyping(false);
          closeList();
          onUseLocation();
        }}
      >
        {locate === "locating" ? "現在地を取得中…" : "現在地を使う"}
      </button>
      <p className="locate-status" data-testid="locate-status">
        {locateText(locate, hereLabel)}
        {locate === "located" && hereLabel !== null ? (
          <span className="google-attribution" data-testid="google-attribution" translate="no">
            {GOOGLE_ATTRIBUTION}
          </span>
        ) : null}
      </p>
      {locate === "idle" ? (
        <p className="locate-note" data-testid="locate-note">
          押すと今いる場所を取り、地名に直すために座標を Google に送ります（<Link href="/privacy">送信先の一覧</Link>）。
        </p>
      ) : null}
      {away ? <p className="locate-away">現在地とは別の場所を指しています。上のボタンでいつでも現在地に戻せます。</p> : null}
      <div className="place-suggest-anchor">
        <input
          id="fetch-place"
          data-testid="field-place"
          type="text"
          placeholder={unavailable ? "駅名や住所を入れてください" : "駅名や住所（空のままなら今いる場所で探します）"}
          value={place}
          maxLength={PLACE_MAX}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={SUGGEST_LIST_ID}
          aria-expanded={listVisible}
          aria-activedescendant={listVisible && activeIndex >= 0 ? `${SUGGEST_LIST_ID}-${activeIndex}` : undefined}
          onChange={(event) => {
            onPlaceChange(event.target.value);
            setTyping(true);
            setSuggestOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (typing) setSuggestOpen(true);
          }}
          onBlur={closeList}
          {...fieldAria("place", failure, "fetch-place", { kinds: PLACE_KINDS })}
        />
        {listVisible ? (
          <ul
            id={SUGGEST_LIST_ID}
            className="place-suggest"
            role="listbox"
            aria-label="場所の候補"
            data-testid="place-suggestions"
            // 行を押した瞬間に欄がフォーカスを失って一覧が閉じないよう、押し始めの既定の動きを止める
            onMouseDown={(event) => event.preventDefault()}
          >
            {suggestions.map((text, index) => (
              <li
                key={text}
                id={`${SUGGEST_LIST_ID}-${index}`}
                className="place-suggest__item"
                role="option"
                aria-selected={index === activeIndex}
                data-testid="place-suggestion"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseSuggestion(text)}
              >
                {text}
              </li>
            ))}
            {/* 候補は Google の地図サービスから来る。同じ入れ物の下端に帰属を出す（選べる行ではない・設計-20） */}
            <li role="presentation" className="place-suggest__attribution google-attribution" data-testid="place-suggest-attribution" translate="no">
              {GOOGLE_ATTRIBUTION}
            </li>
          </ul>
        ) : null}
      </div>
      <FieldMessage inputId="fetch-place" name="place" failure={failure} kinds={PLACE_KINDS} ctx={{ field: "場所", min: 1, max: PLACE_MAX }} />
    </div>
  );
};
