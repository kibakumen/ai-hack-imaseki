"use client";

// 取得の入力（要件3の基準 3.1・3.2・3.7・3.8・3.12・3.13）。
//
// **開いた瞬間に押せる画面**にしてある（2026-09-22 の本人の指摘「理想は…その気になれば画面を
// 開いた瞬間に今すぐ探すボタンを押せること」）。そのための決めが4つ:
//   1. 画面が出た時点で現在地を取りに行き、取れたら**地名に直して場所の欄へ入れておく**
//      （客は欄に書かれている場所を「自分が発信する場所」として読む・基準 3.1 の既定を目に見せる）。
//   2. 欄の中身が**現在地の地名そのまま**なら、送るのは地名ではなく**座標**（地名を送り直すと
//      地図の丸めが1回増えて、ずれる）。客が書き換えたときだけ文字を送る（基準 3.2）。
//   3. 「現在地を使う」を常に置き、**欄の中身が現在地から離れたらそのボタンを強調**する
//      （いつでも現在地に戻せることを見せる）。
//   4. 「今すぐ探す」は**場所の欄のすぐ下**。人数・ジャンル・予算は**その下に常時展開**して
//      「オプション感」を出す（畳まないので、入れたい客はそのまま入れられる）。
//
// 現在地が取れなくても押せる（取れなければ押した時に場所を求める・基準 3.7・3.8）。
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる（設計書「入力の誤りの出し方」
// の規則5）。入力欄の属性（maxLength・min・max）は打ち間違いを減らす補助で、正本ではない。

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiCall, apiStream, isFailure, STREAM_UNAVAILABLE, type ApiFailure, type StreamLine, type StreamOutcome } from "../../lib/client/api";
import { currentLocation, type CurrentLocation } from "../../lib/client/geolocation";
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

/** 現在地の座標。地名に直せたかどうかとは別に持つ（直せなくても座標で探せる）。 */
type Point = { lat: number; lng: number };

/** 現在地を取りに行った結果の見せ方（欄の直下の断りとは別物——押す前の案内なので責めない）。 */
type LocateState = "locating" | "located" | "failed";

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
  // 現在地。座標（探すときに送るもの）と地名（欄に見せるもの）を別に持つ——地名に直せない場所でも
  // 座標で探せるようにするため。`hereLabel` は「欄の中身がまだ現在地のままか」の見分けにも使う。
  const [here, setHere] = useState<Point | null>(null);
  const [hereLabel, setHereLabel] = useState<string | null>(null);
  // 初めの値が「取得中」なのは、下の effect が**描かれた直後に必ず取りに行く**から
  // （effect の中で state を立てると lint `react-hooks/set-state-in-effect` が止める）。
  const [locate, setLocate] = useState<LocateState>("locating");

  const toggleGenre = (genre: string) =>
    setGenres((current) => (current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre]));

  /**
   * 現在地を取り、取れたら地名へ直して場所の欄に入れる。
   * 地名に直せなかったときは欄を空のままにする（座標で探せるので、客には何も求めない）。
   * 取れなかったときはここでは責めず、案内だけを出す（押した時に改めて場所を求める・基準 3.7）。
   */
  const applyLocated = useCallback(async (located: CurrentLocation | ApiFailure): Promise<void> => {
    if (isFailure(located)) {
      setLocate("failed");
      return;
    }
    const point = { lat: located.lat, lng: located.lng };
    setHere(point);
    setLocate("located");
    const answer = await apiCall<{ label?: unknown }>("GET", `/api/customer/place?lat=${point.lat}&lng=${point.lng}`);
    const label = !isFailure(answer) && typeof answer.label === "string" && answer.label !== "" ? answer.label : null;
    setHereLabel(label);
    // 客がもう自分で書き換えていたら上書きしない（書きかけを消さない）。
    if (label !== null) setPlace((current) => (current.trim() === "" ? label : current));
  }, []);

  // 開いた瞬間に現在地を取りに行く（押す前から既定の場所を見せる）。
  // 取得の間もボタンは押せる——待たせないことがこの画面の値打ちなので、押されたら押された側で起点を決める。
  // ⚠️ 現在地の答えを**待ってから** state を変える。effect の本体から直に変える形は
  //    lint（`react-hooks/set-state-in-effect`）が止める（`RegisterForm` の公開値の取り方と同じ形）。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const located = await currentLocation();
      if (alive) await applyLocated(located);
    })();
    return () => {
      alive = false;
    };
  }, [applyLocated]);

  /** 欄の中身が現在地から離れたか（離れている間は「現在地を使う」を強調する）。 */
  const away = hereLabel !== null && place.trim() !== "" && place.trim() !== hereLabel;

  /**
   * 起点を決める（基準 3.1・3.2）。
   * 欄が空か、現在地の地名がそのまま入っているなら**座標**を送る。客が書き換えていれば文字を送る。
   */
  const origin = async (): Promise<{ place: string } | Point | ApiFailure> => {
    const trimmed = place.trim();
    const useHere = trimmed === "" || (hereLabel !== null && trimmed === hereLabel);
    if (!useHere) return { place: trimmed };
    if (here !== null) return { lat: here.lat, lng: here.lng };
    const located = await currentLocation();
    return isFailure(located) ? located : { lat: located.lat, lng: located.lng };
  };

  /**
   * 少しずつ届く入口で探す（`init` で店のカードを先に出し、`pitch` が届くたびに紹介文だけを差し替える）。
   * この入口を持たないサーバーでは `STREAM_UNAVAILABLE` が返るので、呼ぶ側が普通の入口へ倒す。
   */
  const searchByStream = async (payload: Record<string, unknown>): Promise<StreamOutcome> => {
    let current: FetchResult | null = null;
    const outcome = await apiStream("/api/customer/fetch/stream", payload, (line: StreamLine) => {
      if (line.type === "init" && typeof line.fetchId === "string" && Array.isArray(line.items)) {
        current = { fetchId: line.fetchId, items: line.items as ResultItem[], party: Number(party) };
        onResults(current);
        // カードが出た時点で「探しています…」を解く（紹介文は後から差し込まれる）
        setPending(false);
        return;
      }
      if (line.type === "pitch" && current !== null && typeof line.storeId === "string" && typeof line.reason === "string") {
        const { storeId, reason } = line;
        const shown: FetchResult = current;
        current = { ...shown, items: shown.items.map((item) => (item.storeId === storeId ? { ...item, reason } : item)) };
        onResults(current);
      }
    });
    // 1行も届かなかった応答は「少しずつ届く入口が働いていない」とみなし、普通の入口へ倒す
    return outcome === null && current === null ? STREAM_UNAVAILABLE : outcome;
  };

  const submit = async () => {
    setFailure(null);
    onResults(null);
    const from = await origin();
    if (isFailure(from)) {
      setFailure(from);
      return;
    }
    const payload = { ...from, party: partyToSend(party), genres, budgetMax: budgetToSend(budgetMax) };
    const streamed = await searchByStream(payload);
    if (streamed !== STREAM_UNAVAILABLE) {
      if (isFailure(streamed)) setFailure(streamed);
      return;
    }
    const result = await apiCall<FetchOk>("POST", "/api/customer/fetch", payload);
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

      <div className="fetch-place">
        <label htmlFor="fetch-place">いる場所</label>
        <button
          type="button"
          data-testid="btn-use-location"
          className={away ? "use-location use-location-away" : "use-location"}
          disabled={locate === "locating"}
          onClick={() => {
            // 取り直さずに済むなら、持っている現在地をそのまま欄へ戻す。
            if (here !== null && hereLabel !== null) {
              setPlace(hereLabel);
              return;
            }
            setLocate("locating");
            void (async () => applyLocated(await currentLocation()))();
          }}
        >
          {locate === "locating" ? "現在地を取得中…" : "現在地を使う"}
        </button>
        <p className="locate-status" data-testid="locate-status">
          {locate === "locating" ? "現在地を取得しています…" : null}
          {locate === "located" && hereLabel !== null ? `現在地: ${hereLabel}` : null}
          {locate === "located" && hereLabel === null ? "現在地は取れました（地名にはできませんでした）。そのまま探せます。" : null}
          {locate === "failed" ? "現在地が取れませんでした。下の欄に場所を入れてください。" : null}
        </p>
        {away ? <p className="locate-away">現在地とは別の場所を指しています。上のボタンでいつでも現在地に戻せます。</p> : null}
        <input
          id="fetch-place"
          data-testid="field-place"
          type="text"
          placeholder="駅名や住所（空のままなら今いる場所で探します）"
          value={place}
          maxLength={PLACE_MAX}
          onChange={(event) => setPlace(event.target.value)}
        />
        <FieldMessage name="place" failure={failure} kinds={PLACE_KINDS} ctx={{ field: "場所", min: 1, max: PLACE_MAX }} />
      </div>

      {/* 場所のすぐ下（本人の指摘）。ここから下は全部「こだわり条件」＝入れなくても探せる。 */}
      <button type="submit" className="fetch-submit" data-testid="btn-fetch" disabled={pending}>
        {pending ? "探しています…" : "今すぐ探す"}
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />

      <div className="fetch-options">
        <p className="fetch-options-title">こだわり条件（入れなくても探せます）</p>

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
      </div>
    </form>
  );
};

export default FetchForm;
