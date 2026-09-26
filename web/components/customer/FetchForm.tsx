"use client";

// 取得の入力（要件3の基準 3.1・3.2・3.7・3.8・3.12・3.13）。
//
// **開いた瞬間に押せる画面**にしてある（2026-09-22 の本人の指摘「理想は…その気になれば画面を
// 開いた瞬間に今すぐ探すボタンを押せること」）。そのための決めが4つ:
//   1. 現在地が取れたら**地名に直して場所の欄へ入れておく**（客は欄に書かれている場所を「自分が発信する
//      場所」として読む・基準 3.1 の既定を目に見せる）。⚠️ 取りに行くのは、客が一度「現在地を使う」を
//      押した端末だけ（2026-09-25 監査の指摘 安全-18。初めての客には押す前に何も送らない・`useHereLocation`）。
//   2. 欄の中身が**現在地の地名そのまま**なら、送るのは地名ではなく**座標**（地名を送り直すと
//      地図の丸めが1回増えて、ずれる）。客が書き換えたときだけ文字を送る（基準 3.2）。
//   3. 「現在地を使う」を常に置き、**欄の中身が現在地から離れたらそのボタンを強調**する
//      （いつでも現在地に戻せることを見せる・`PlaceField`）。
//   4. 「今すぐ探す」は**場所の欄のすぐ下**。こだわり条件は**その下に常時展開**して
//      「オプション感」を出す（畳まないので、入れたい客はそのまま入れられる）。
//
// 2026-09-22 の本人の指摘（第3回）で足した3つ:
//   5. 場所の欄に**打っている最中の候補**を出す（`client/placeSuggest`・`PlaceField`）。
//   6. こだわり条件の並びは **予算 → ジャンル**（「予算は好みよりも重要な情報なので、人数のすぐ下に」）。
//      人数は「今すぐ探す」の直前に −/＋ つきで出した（2026-09-25 監査の指摘 客-07・`PartyStepper`）。
//   7. こだわり条件の**いちばん下に電話番号（任意）**（`PhoneField`）。
//   8. 先頭に**声で入れる**ボタン（2026-09-25 監査の指摘 客-16・`VoiceInput`。聞き取った人数・予算・ジャンルを欄へ入れる）。
//
// 2026-09-26 本人選択: 欄の文字が Google から来たか（場所の候補を選んだ・現在地の地名を入れた）を覚え、そのまま探すときは
//   印（placeFromCandidate）を添える。サーバーはその文字を記録に書かない（期限なく残すのは place ID だけ）。
//   客が全部消した・頭から打ち直した（頭の文字が変わった）ら客の文字として扱う。書き足し・途中の直しは Google の文字のまま
//   （区別できないものは書かない側へ倒す・AI判断）。
//
// 現在地が取れなくても押せる（取れなければ押した時に場所を求める・基準 3.7・3.8）。
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる（設計書「入力の誤りの出し方」
// の規則5）。入力欄の属性（maxLength・min・max）は打ち間違いを減らす補助で、正本ではない。
// 取得の走らせ方（前の取得を止める・紹介文を確定させる）は `useOfferSearch` が持つ。

import { useCallback, useState, type FormEvent } from "react";
import { isFailure, type ApiFailure } from "../../lib/client/api";
import { rememberOrigin } from "../../lib/client/lastOrigin";
import type { SpokenConditions } from "../../lib/client/voiceConditions";
import { TEXTS } from "../../lib/domain/texts";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { BudgetChips } from "./BudgetChips";
import { fetchButtonText, PartyStepper } from "./PartyStepper";
import { PhoneField, useOptionalPhone } from "./PhoneField";
import { PlaceField } from "./PlaceField";
import { EMPTY_RESULT_TEXT } from "./ResultList";
import { useHereLocation, type Point } from "./useHereLocation";
import { useOfferSearch, type FetchResult } from "./useOfferSearch";
import { VoiceInput } from "./VoiceInput";

export type { FetchOrigin, FetchResult } from "./useOfferSearch";
export { phoneToShow, phoneToStore } from "./PhoneField";

const FIELD_NAMES = ["place", "party", "genres", "budgetMax"];

/** 場所の欄の文字と、その文字が Google から来たか（場所の候補・現在地の地名）。 */
type PlaceInput = { text: string; fromCandidate: boolean };

/**
 * 客が欄を打った（消した）あとの欄。空になった・頭の文字が変わった（全部選んで打ち直した）ら客の文字。
 * それ以外（書き足し・途中の直し）は、前が Google の文字なら Google の文字のまま（AI判断）。
 */
export const typedPlace = (current: PlaceInput, text: string): PlaceInput => ({
  text,
  fromCandidate: current.fromCandidate && text.trim() !== "" && text.trim()[0] === current.text.trim()[0],
});

/** 数にならない文字はそのまま送り、判定は入口の検査に任せる（画面は送る前に自分で検査しない）。 */
const toNumber = (raw: string): number | string => {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  return Number.isNaN(value) ? trimmed : value;
};

/**
 * 空欄の人数は**項目を載せずに**送る（基準 3.11）。`null` で送ると入口の検査が「整数で入れて
 * ください」と答えてしまい、空欄の客に噛み合わない。項目が無ければ「人数を入れてください」になる。
 */
export const partyToSend = (raw: string): number | string | undefined => (raw.trim() === "" ? undefined : toNumber(raw));

/** 空欄の予算は「上限なし」（`null`）。登録の予算が未指定の客と同じ扱い。 */
export const budgetToSend = (raw: string): number | string | null => (raw.trim() === "" ? null : toNumber(raw));

type FetchFormProps = {
  /**
   * 登録の値（その回の好みの初めの値・基準 3.13）。応答の形を検査していないので在ることに頼らない。
   * 呼び名と電話番号は、電話番号の欄が登録の変更の入口へ4項目まとめて送るために読む。
   */
  profile?: { nickname?: string; phone?: string; genres?: string[]; budgetMax?: number | null };
  /**
   * 人数だけは**このフォームの外**（`CustomerApp`）が持つ。受け取りが「◯名まで」で断られたときの
   * 「◯名で探し直す」が、結果の一覧の側から人数を入れ替えるため（設計書「客の画面」の断りの次の一手）。
   * 場所・ジャンル・予算は外から変える道が無いのでフォームの中に置いたまま（探し直しても残る）。
   * ⚠️ prop を effect で state へ写す形は lint（`react-hooks/set-state-in-effect`）が止める。
   */
  party: string;
  onPartyChange: (party: string) => void;
  /** 取得が通ったら結果を渡し、断られたら `null` を渡す（結果の一覧を出したままにしない）。 */
  onResults: (result: FetchResult | null) => void;
  /**
   * 直前の取得が0件だったか。真なら「今すぐ探す」のすぐ下に、断りと同じ体裁で次の手の文を出す
   * （2026-09-22 の本人の指摘「下の方じゃなくて、すぐ見える上のほうでエラーメッセージとして」）。
   * 文面は `ResultList` の `EMPTY_RESULT_TEXT`（置き場所だけを上へ移した）。
   */
  noResults?: boolean;
  /**
   * 畳むか（結果が1件以上出ているとき、入れ物が真にする・2026-09-22 の本人の指摘「オファーをみたい」）。
   * ⚠️ 畳んでも**描かないのではなく CSS で隠す**——欄は DOM に残る（受け入れ検査が `data-testid` で掴む）。
   */
  collapsed?: boolean;
};

export const FetchForm = ({ profile, party, onPartyChange, onResults, noResults = false, collapsed = false }: FetchFormProps) => {
  const [placeInput, setPlaceInput] = useState<PlaceInput>({ text: "", fromCandidate: false });
  const place = placeInput.text;
  const typePlace = (text: string) => setPlaceInput((current) => typedPlace(current, text));
  const choosePlace = (text: string) => setPlaceInput({ text, fromCandidate: true });
  const [genres, setGenres] = useState<string[]>(profile?.genres ?? []);
  const [budgetMax, setBudgetMax] = useState(profile?.budgetMax == null ? "" : String(profile.budgetMax));
  const { pending, failure, search } = useOfferSearch(onResults);
  const phone = useOptionalPhone(profile);
  // 地名が取れたら欄へ入れる。客がもう自分で書き換えていたら上書きしない（書きかけを消さない）。
  const fillHereLabel = useCallback((label: string) => setPlaceInput((current) => (current.text.trim() === "" ? { text: label, fromCandidate: true } : current)), []);
  const location = useHereLocation(fillHereLabel);
  const { hereLabel } = location;

  const toggleGenre = (genre: string) =>
    setGenres((current) => (current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre]));

  /** 声で読み取れた条件を欄へ入れる（読めなかった項目は今の値のまま・探すのは客が押したとき）。 */
  const applySpoken = (conditions: SpokenConditions) => {
    if (conditions.party !== undefined) onPartyChange(String(conditions.party));
    if (conditions.budgetMax !== undefined) setBudgetMax(conditions.budgetMax === null ? "" : String(conditions.budgetMax));
    if (conditions.genres !== undefined && conditions.genres.length > 0) setGenres(conditions.genres);
  };

  /** 欄の中身が現在地から離れたか（離れている間は「現在地を使う」を強調する）。 */
  const away = hereLabel !== null && place.trim() !== "" && place.trim() !== hereLabel;

  /** 「現在地を使う」: 取り直さずに済むなら、持っている現在地の地名をそのまま欄へ戻す。 */
  const backToHere = () => {
    if (location.here !== null && hereLabel !== null) {
      choosePlace(hereLabel);
      return;
    }
    location.locateNow();
  };

  /**
   * 起点を決める（基準 3.1・3.2）。
   * 欄が空か、現在地の地名がそのまま入っているなら**座標**を送る。客が書き換えていれば文字を送る。
   */
  const origin = async (): Promise<{ place: string; placeFromCandidate?: true } | Point | ApiFailure> => {
    const trimmed = place.trim();
    const useCoordinates = trimmed === "" || (hereLabel !== null && trimmed === hereLabel);
    if (useCoordinates) return location.pointForSearch();
    return placeInput.fromCandidate ? { place: trimmed, placeFromCandidate: true } : { place: trimmed };
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 電話番号は探すのと並行して保存する（保存の断りは電話番号の欄の直下に出て、探すのは止めない）。
    void phone.persist();
    void search(async () => {
      const from = await origin();
      if (isFailure(from)) return from;
      // 経路の出発地は、打った場所で探したときだけ（2026-09-25 監査の指摘 客-11）。現在地で探したときは付けない
      // ——探した時点の座標を固定の出発地にすると、歩き出したあとの経路が探した場所から引かれる。
      // そのタブの中で覚えておく（読み直しても残るように）。現在地のときは前に覚えた場所も消す。
      // 場所の候補から来た文字（Google の Places が返した文字）も覚えず、結果にも載せない（2026-09-26 独立した再レビューの指摘）。
      // place ID が無いときに、ここから Google マップの origin へ回っていた。候補のときの出発地は、サーバーの応答
      // （place ID と決まった文字）だけが渡す——/privacy の「候補から選んだときは文字の代わりに『探した場所』と送る」と揃える。
      const routeFrom = "place" in from && from.placeFromCandidate !== true ? { place: from.place } : null;
      rememberOrigin(routeFrom);
      return { payload: { ...from, party: partyToSend(party), genres, budgetMax: budgetToSend(budgetMax) }, party: Number(party), from: routeFrom };
    });
  };

  return (
    <form data-testid="form-fetch" className={collapsed ? "fetch-form fetch-form--collapsed" : "fetch-form"} noValidate onSubmit={handleSubmit}>
      <h2>今入れるお店を探す</h2>

      {/* 先頭にワンタップで声で入れる（2026-09-25 監査の指摘 客-16・本人の第1回の指摘「歩きながら音声で入れたい」） */}
      <VoiceInput onApply={applySpoken} />

      <PlaceField place={place} onPlaceChange={typePlace} onChooseCandidate={choosePlace} locate={location.locate} hereLabel={hereLabel} away={away} onUseLocation={backToHere} failure={failure} />

      {/* 人数は「今すぐ探す」の直前（客-07）。ボタンの文言にも今の人数を載せ、1名のまま押したことに気づけるようにする */}
      <PartyStepper party={party} onPartyChange={onPartyChange} failure={failure} />

      {/* 場所のすぐ下（本人の指摘）。ここから下は全部「こだわり条件」＝入れなくても探せる。 */}
      <button type="submit" className="fetch-submit" data-testid="btn-fetch" disabled={pending}>
        {pending ? "探しています…" : fetchButtonText(party)}
      </button>
      {/* 0件の文は押した人の目にまず入る位置（ボタンのすぐ下）に、断りと同じ体裁で出す */}
      {noResults ? (
        <p className="msg" role="alert" data-testid="result-empty">
          {EMPTY_RESULT_TEXT}
        </p>
      ) : null}
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />

      <div className="fetch-options">
        <p className="fetch-options-title">こだわり条件（入れなくても探せます）</p>

        {/* 予算は好みより効く情報なので、こだわり条件のいちばん上（本人の指摘・2026-09-22「人数のすぐ下に」） */}
        {/* 押して選ぶチップ（2026-09-25 監査の指摘 客-15・本人の指摘「予算も専用のフォームがあった方が入力しやすい」） */}
        <BudgetChips value={budgetMax} onChange={setBudgetMax} registered={profile?.budgetMax ?? null} failure={failure} />

        <fieldset id="fetch-genres" data-testid="field-genres" {...fieldAria("genres", failure, "fetch-genres")}>
          <legend>今の気分のジャンル（この回だけ・登録は変わりません）</legend>
          {TEXTS.genres.map((genre) => (
            <label key={genre}>
              <input type="checkbox" data-testid={`genre-${genre}`} checked={genres.includes(genre)} onChange={() => toggleGenre(genre)} />
              {genre}
            </label>
          ))}
        </fieldset>
        <FieldMessage inputId="fetch-genres" name="genres" failure={failure} ctx={{ field: "ジャンル" }} />

        {/* いちばん下に電話番号（任意・本人の指摘「こだわり条件の下に任意で電話番号を登録できるように」） */}
        <PhoneField {...phone} />
      </div>
    </form>
  );
};

export default FetchForm;
