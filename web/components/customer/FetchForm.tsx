"use client";

// 取得の入力（要件3の基準 3.1・3.2・3.7・3.8・3.12・3.13）。場所の欄はいつも出ていて、空なら
// その時点の現在地を起点にする（基準 3.1）。文字が入っていれば現在地は取りに行かない（基準 3.2）。
// その回のジャンルと予算は、登録の値を初めの値として入れておく（基準 3.13）。変えた値はこの回の
// 要求にだけ載る——登録へ書き戻す入口を呼ばない（基準 3.14）。
//
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる（設計書「入力の誤りの出し方」
// の規則5）。入力欄の属性（maxLength・min・max）は打ち間違いを減らす補助で、正本ではない。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { currentLocation } from "../../lib/client/geolocation";
import { TEXTS } from "../../lib/domain/texts";
import { BUDGET_MAX_MAX, BUDGET_MAX_MIN, PARTY_MAX, PARTY_MIN, PLACE_MAX } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";
import type { ResultItem } from "./ResultList";

const FIELD_NAMES = ["place", "party", "genres", "budgetMax"];
/**
 * 場所の欄の直下に出す、規則の断りの語（理由だけでは何が起きたか伝わらないもの）。
 * `location_required` は現在地が取れなかった（`client/geolocation` が返す・基準 3.7・3.8）、
 * `place_unresolved` は入れた文字が位置に直せなかった（基準 3.4〜3.6）。
 * 語から文を選ぶのは部品 `InputRefusal` の仕事で、ここは項目との結びつきだけを渡す。
 */
const PLACE_KINDS = ["location_required", "place_unresolved"];

/** 取得が通ったときに親へ渡すもの（受け取りの入口が `fetchId` と人数を要るため）。 */
export type FetchResult = { fetchId: string; items: ResultItem[]; party: number };

type FetchOk = { fetchId: string; items: ResultItem[] };

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
  /** 登録の値（その回の好みの初めの値・基準 3.13）。応答の形を検査していないので在ることに頼らない。 */
  profile?: { genres?: string[]; budgetMax?: number | null };
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
};

export const FetchForm = ({ profile, party, onPartyChange, onResults }: FetchFormProps) => {
  const [place, setPlace] = useState("");
  const [genres, setGenres] = useState<string[]>(profile?.genres ?? []);
  const [budgetMax, setBudgetMax] = useState(profile?.budgetMax == null ? "" : String(profile.budgetMax));
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);

  const toggleGenre = (genre: string) =>
    setGenres((current) => (current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre]));

  /** 起点を決める。場所の文字が在ればそれを送り、無ければ現在地を取る（基準 3.1・3.2）。 */
  const origin = async (): Promise<{ place: string } | { lat: number; lng: number } | ApiFailure> => {
    const trimmed = place.trim();
    if (trimmed !== "") return { place: trimmed };
    const located = await currentLocation();
    return isFailure(located) ? located : { lat: located.lat, lng: located.lng };
  };

  const submit = async () => {
    setFailure(null);
    onResults(null);
    const from = await origin();
    if (isFailure(from)) {
      setFailure(from);
      return;
    }
    const result = await apiCall<FetchOk>("POST", "/api/customer/fetch", {
      ...from,
      party: partyToSend(party),
      genres,
      budgetMax: budgetToSend(budgetMax),
    });
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    onResults({ fetchId: result.fetchId, items: result.items, party: Number(party) });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    void submit().finally(() => setPending(false));
  };

  return (
    <form data-testid="form-fetch" noValidate onSubmit={handleSubmit}>
      <h2>今入れるお店を探す</h2>

      <label htmlFor="fetch-place">場所（空のままにすると、今いる場所で探します）</label>
      <input
        id="fetch-place"
        data-testid="field-place"
        type="text"
        placeholder="駅名や住所"
        value={place}
        maxLength={PLACE_MAX}
        onChange={(event) => setPlace(event.target.value)}
      />
      <FieldMessage name="place" failure={failure} kinds={PLACE_KINDS} ctx={{ field: "場所", min: 1, max: PLACE_MAX }} />

      <label htmlFor="fetch-party">人数</label>
      <input
        id="fetch-party"
        data-testid="field-party"
        type="number"
        inputMode="numeric"
        min={PARTY_MIN}
        max={PARTY_MAX}
        value={party}
        onChange={(event) => onPartyChange(event.target.value)}
      />
      <FieldMessage name="party" failure={failure} ctx={{ field: "人数", min: PARTY_MIN, max: PARTY_MAX }} />

      <fieldset data-testid="field-genres">
        <legend>今の気分のジャンル（この回だけ・登録は変わりません）</legend>
        {TEXTS.genres.map((genre) => (
          <label key={genre}>
            <input type="checkbox" data-testid={`genre-${genre}`} checked={genres.includes(genre)} onChange={() => toggleGenre(genre)} />
            {genre}
          </label>
        ))}
      </fieldset>
      <FieldMessage name="genres" failure={failure} ctx={{ field: "ジャンル" }} />

      <label htmlFor="fetch-budget">1人あたりの予算の上限（この回だけ・空なら上限なし）</label>
      <input
        id="fetch-budget"
        data-testid="field-budgetMax"
        type="number"
        inputMode="numeric"
        min={BUDGET_MAX_MIN}
        max={BUDGET_MAX_MAX}
        value={budgetMax}
        onChange={(event) => setBudgetMax(event.target.value)}
      />
      <FieldMessage name="budgetMax" failure={failure} ctx={{ field: "予算の上限", min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />

      <button type="submit" data-testid="btn-fetch" disabled={pending}>
        {pending ? "探しています…" : "今入れる店を探す"}
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
    </form>
  );
};

export default FetchForm;
