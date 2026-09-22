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
//   4. 「今すぐ探す」は**場所の欄のすぐ下**。こだわり条件は**その下に常時展開**して
//      「オプション感」を出す（畳まないので、入れたい客はそのまま入れられる）。
//
// 2026-09-22 の本人の指摘（第3回）で足した3つ:
//   5. 場所の欄に**打っている最中の候補**を出す（`client/placeSuggest`）。候補は補助で、出なくても
//      今までどおり文字のまま「今すぐ探す」が押せる。↑↓ と Enter で選べ、Esc で閉じる。
//   6. こだわり条件の並びは **人数 → 予算 → ジャンル**（「予算は好みよりも重要な情報なので、人数のすぐ下に」）。
//   7. こだわり条件の**いちばん下に電話番号（任意）**。自動の登録は仮の番号（`GUEST_PHONE_PLACEHOLDER`）で
//      済ませてあるので、仮のままなら欄は空で見せ、入れられたら登録の変更の入口（`PATCH /api/customer/profile`）
//      で本物に差し替える。空のままで「今すぐ探す」が押せる（必須にしない）。
//
// 現在地が取れなくても押せる（取れなければ押した時に場所を求める・基準 3.7・3.8）。
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる（設計書「入力の誤りの出し方」
// の規則5）。入力欄の属性（maxLength・min・max）は打ち間違いを減らす補助で、正本ではない。

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { apiCall, apiStream, isFailure, STREAM_UNAVAILABLE, type ApiFailure, type StreamLine, type StreamOutcome } from "../../lib/client/api";
import { currentLocation, type CurrentLocation } from "../../lib/client/geolocation";
import { usePlaceSuggestions } from "../../lib/client/placeSuggest";
import { TEXTS } from "../../lib/domain/texts";
import { BUDGET_MAX_MAX, BUDGET_MAX_MIN, GUEST_PHONE_PLACEHOLDER, PARTY_MAX, PARTY_MIN, PHONE_MAX_LENGTH, PLACE_MAX } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";
import { EMPTY_RESULT_TEXT, type ResultItem } from "./ResultList";

const FIELD_NAMES = ["place", "party", "genres", "budgetMax"];
/**
 * 場所の欄の直下に出す、規則の断りの語（理由だけでは何が起きたか伝わらないもの）。
 * `location_required` は現在地が取れなかった（`client/geolocation` が返す・基準 3.7・3.8）、
 * `place_unresolved` は入れた文字が位置に直せなかった（基準 3.4〜3.6）。
 * 語から文を選ぶのは部品 `InputRefusal` の仕事で、ここは項目との結びつきだけを渡す。
 */
const PLACE_KINDS = ["location_required", "place_unresolved"];
const PHONE_HINT = "数字10桁か11桁";
const SUGGEST_LIST_ID = "fetch-place-suggestions";

/** 取得が通ったときに親へ渡すもの（受け取りの入口が `fetchId` と人数を要るため）。 */
/** 探した起点。座標か、客が打った場所の文字。地図の経路の出発地にそのまま渡せる（2026-09-22）。 */
export type FetchOrigin = { lat: number; lng: number } | { place: string };

export type FetchResult = { fetchId: string; items: ResultItem[]; party: number; from: FetchOrigin | null };

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

/**
 * 登録されている電話番号を、欄に見せる形へ直す。仮の番号（自動の登録が入れたもの）は**空**で見せる
 * ——客に「0000000000」を見せると自分の番号だと誤読するため。
 */
export const phoneToShow = (stored: string | undefined | null): string => (typeof stored !== "string" || stored === GUEST_PHONE_PLACEHOLDER ? "" : stored);

/** 欄の値を、登録へ送る形へ直す。空欄は仮の番号へ戻す（＝番号を消したことになる）。 */
export const phoneToStore = (raw: string): string => (raw.trim() === "" ? GUEST_PHONE_PLACEHOLDER : raw.trim());

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

  // 場所の候補。`typing` は客が自分で打っている最中か（現在地の地名を自動で入れた直後や候補を選んだ
  // 直後は false＝聞きに行かない）。`suggestOpen` は一覧を見せているか、`activeIndex` はキーボードで
  // 選んでいる行（-1 は無し）。
  const [typing, setTyping] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = usePlaceSuggestions(place, typing);
  const listVisible = suggestOpen && suggestions.length > 0;

  // 電話番号（任意）。欄の値・登録されている値（仮の番号を含む）・送っている最中の値・断りを別に持つ。
  // 登録されている値と送っている最中の値は ref——欄を離れた直後に「今すぐ探す」を押されても、
  // 同じ値を2度送らないため（state だと更新が描き直しまで届かない）。
  const [phone, setPhone] = useState(phoneToShow(profile?.phone));
  const [phoneFailure, setPhoneFailure] = useState<ApiFailure | null>(null);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const storedPhoneRef = useRef<string | null>(typeof profile?.phone === "string" ? profile.phone : null);
  const savingPhoneRef = useRef<string | null>(null);

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

  /** 候補を1つ選ぶ: 欄にその文字を入れ、一覧を閉じる（選んだ文字を打ち直すまで、また聞きに行かない）。 */
  const chooseSuggestion = (text: string) => {
    setPlace(text);
    setTyping(false);
    setSuggestOpen(false);
    setActiveIndex(-1);
  };

  /** 場所の欄のキー操作。一覧が出ている間だけ ↑↓・Enter・Esc を取る（出ていなければ Enter は「今すぐ探す」）。 */
  const onPlaceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!listVisible) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && activeIndex < suggestions.length) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSuggestOpen(false);
      setActiveIndex(-1);
    }
  };

  /**
   * 電話番号を登録へ保存する（欄を離れたとき・「今すぐ探す」を押したとき）。
   * 登録されている値と同じなら送らない。登録の変更の入口は4項目まとめて受けるので、呼び名・ジャンル・予算は
   * **登録の値**（この回の好みではない）をそのまま添える。呼び名が読めない応答では保存できないので何もしない。
   */
  const persistPhone = async (): Promise<void> => {
    const nickname = profile?.nickname;
    if (typeof nickname !== "string") return;
    const next = phoneToStore(phone);
    if (next === storedPhoneRef.current || next === savingPhoneRef.current) return;
    savingPhoneRef.current = next;
    const result = await apiCall("PATCH", "/api/customer/profile", { nickname, phone: next, genres: profile?.genres ?? [], budgetMax: profile?.budgetMax ?? null });
    if (savingPhoneRef.current === next) savingPhoneRef.current = null;
    if (isFailure(result)) {
      setPhoneFailure(result);
      setPhoneSaved(false);
      return;
    }
    storedPhoneRef.current = next;
    setPhoneFailure(null);
    setPhoneSaved(next !== GUEST_PHONE_PLACEHOLDER);
  };

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
  const searchByStream = async (payload: Record<string, unknown>, from: FetchOrigin): Promise<StreamOutcome> => {
    let current: FetchResult | null = null;
    const outcome = await apiStream("/api/customer/fetch/stream", payload, (line: StreamLine) => {
      if (line.type === "init" && typeof line.fetchId === "string" && Array.isArray(line.items)) {
        current = { fetchId: line.fetchId, items: line.items as ResultItem[], party: Number(party), from };
        onResults(current);
        // カードが出た時点で「探しています…」を解く（紹介文は後から差し込まれる）
        setPending(false);
        return;
      }
      if (line.type === "pitch" && current !== null && typeof line.storeId === "string" && typeof line.reason === "string") {
        const { storeId, reason } = line;
        // ⚠️ `source` も一緒に取り込む（2026-09-22 本人の指摘「文言が完成されているのにずっと待機モーションになっている」）。
        // ここで `reason` だけ差し替えていたため、文は届いているのに `pitchSource` が `undefined` のまま残り、
        // `OfferPitch` が待機の見た目（光の帯と「書いています…」）を出し続けていた。
        // 入口が知らない値を送ってきたときは「決定論の文」側へ倒す——待機のまま固まるよりはよい。
        const source = line.source === "persona" ? "persona" : "fallback";
        const shown: FetchResult = current;
        current = { ...shown, items: shown.items.map((item) => (item.storeId === storeId ? { ...item, reason, pitchSource: source } : item)) };
        onResults(current);
      }
    });
    // 1行も届かなかった応答は「少しずつ届く入口が働いていない」とみなし、普通の入口へ倒す
    return outcome === null && current === null ? STREAM_UNAVAILABLE : outcome;
  };

  const submit = async () => {
    setFailure(null);
    onResults(null);
    // 電話番号は探すのと並行して保存する（保存の断りは電話番号の欄の直下に出て、探すのは止めない）。
    void persistPhone();
    const from = await origin();
    if (isFailure(from)) {
      setFailure(from);
      return;
    }
    const payload = { ...from, party: partyToSend(party), genres, budgetMax: budgetToSend(budgetMax) };
    const streamed = await searchByStream(payload, from);
    if (streamed !== STREAM_UNAVAILABLE) {
      if (isFailure(streamed)) setFailure(streamed);
      return;
    }
    const result = await apiCall<FetchOk>("POST", "/api/customer/fetch", payload);
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    onResults({ fetchId: result.fetchId, items: result.items, party: Number(party), from });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuggestOpen(false);
    setPending(true);
    void submit().finally(() => setPending(false));
  };

  return (
    <form data-testid="form-fetch" className={collapsed ? "fetch-form fetch-form--collapsed" : "fetch-form"} noValidate onSubmit={handleSubmit}>
      <h2>今入れるお店を探す</h2>

      <div className="fetch-place">
        <label htmlFor="fetch-place">いる場所</label>
        <button
          type="button"
          data-testid="btn-use-location"
          className={away ? "use-location use-location-away" : "use-location"}
          disabled={locate === "locating"}
          onClick={() => {
            setTyping(false);
            setSuggestOpen(false);
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
        <div className="place-suggest-anchor">
          <input
            id="fetch-place"
            data-testid="field-place"
            type="text"
            placeholder="駅名や住所（空のままなら今いる場所で探します）"
            value={place}
            maxLength={PLACE_MAX}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={SUGGEST_LIST_ID}
            aria-expanded={listVisible}
            aria-activedescendant={listVisible && activeIndex >= 0 ? `${SUGGEST_LIST_ID}-${activeIndex}` : undefined}
            onChange={(event) => {
              setPlace(event.target.value);
              setTyping(true);
              setSuggestOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={onPlaceKeyDown}
            onFocus={() => {
              if (typing) setSuggestOpen(true);
            }}
            onBlur={() => setSuggestOpen(false)}
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
            </ul>
          ) : null}
        </div>
        <FieldMessage name="place" failure={failure} kinds={PLACE_KINDS} ctx={{ field: "場所", min: 1, max: PLACE_MAX }} />
      </div>

      {/* 場所のすぐ下（本人の指摘）。ここから下は全部「こだわり条件」＝入れなくても探せる。 */}
      <button type="submit" className="fetch-submit" data-testid="btn-fetch" disabled={pending}>
        {pending ? "探しています…" : "今すぐ探す"}
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

        {/* 予算は好みより効く情報なので、人数のすぐ下（本人の指摘・2026-09-22） */}
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

        {/* いちばん下に電話番号（任意・本人の指摘「こだわり条件の下に任意で電話番号を登録できるように」） */}
        <label htmlFor="fetch-phone">電話番号（任意）</label>
        <p className="fetch-phone-note">お店が緊急時に連絡できるようにするためのものです。入れなくても探せます。</p>
        <input
          id="fetch-phone"
          data-testid="field-phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="09012345678"
          value={phone}
          maxLength={PHONE_MAX_LENGTH}
          onChange={(event) => {
            setPhone(event.target.value);
            setPhoneSaved(false);
          }}
          onBlur={() => void persistPhone()}
        />
        <FieldMessage name="phone" failure={phoneFailure} ctx={{ field: "電話番号", hint: PHONE_HINT }} />
        <FormMessage failure={phoneFailure} fieldNames={["phone"]} />
        {phoneSaved ? (
          <p className="fetch-phone-status" data-testid="phone-saved">
            電話番号を登録しました。
          </p>
        ) : null}
      </div>
    </form>
  );
};

export default FetchForm;
