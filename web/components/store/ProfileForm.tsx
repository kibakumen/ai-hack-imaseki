"use client";

// 店の情報の入力（要件15の基準 15.1〜15.12）。打つ欄は6つ（店名・住所・ホームページの URL・
// ジャンル・おすすめメニュー・1人あたりの予算の幅）。値段やアレルゲンつきの提供メニューの欄と、
// 1つの値の目安料金の欄は持たない（基準 15.12）。
//
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる（設計書「入力の誤りの出し方」の
// 規則5）。断られても打った6項目はそのまま残す——住所が位置に直せなかったときに、
// 全部打ち直させないため（基準 15.10 の「入れ直すかやり直す」）。
//
// **読めたときだけ欄を出す**（2026-09-25 レビューの指摘・横断-01 と同じ種類の穴）。それまでは読み込みが
// 断られても通信に失敗しても、何も言わずに空の欄を出していた。店は「消えた」と思って入れ直し、保存すると
// 入れ直さなかった URL やおすすめメニューが空で上書きされる。書類やクーポンの画面と同じく読み込みを
// useLoad と LoadView に載せ、失敗したら断りの文と「もう一度読み込む」だけを出す。

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { callApi, isFailure, type ApiFailure, type ResponseOf } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { SUBMIT_TEXTS, TEXTS } from "../../lib/domain/texts";
import {
  BUDGET_MAX_MAX,
  BUDGET_MAX_MIN,
  MENU_NAME_MAX,
  MENU_NAME_MIN,
  MENUS_MAX,
  STORE_ADDRESS_MAX,
  STORE_ADDRESS_MIN,
  STORE_GENRES_MAX,
  STORE_GENRES_MIN,
  STORE_NAME_MAX,
  STORE_NAME_MIN,
  STORE_URL_MAX,
} from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { LoadView } from "../ui/LoadState";
import { DoneNotice, SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";

/** 店の情報（型は schemas/responses の表から・設計-07）。 */
type StoreProfile = ResponseOf<"GET /api/store/profile">["profile"];

const FIELD_NAMES = ["name", "address", "url", "genres", "menus", "budgetMin", "budgetMax"];
/** 住所の欄は、形の誤りだけでなく「位置に直せなかった」も直下に出す（基準 15.10）。 */
const ADDRESS_KINDS = ["address_unresolved"];
const URL_HINT = "http:// か https:// で始まる形";
/** 日本語の変換の途中のキー操作が名乗るキーの番号（古い Safari は isComposing を立てずにこれだけを送る） */
const IME_KEY_CODE = 229;
/** 予算の2つの欄は同じ呼び名にする（「〜の最低は最高以下に」の文がそのまま読めるように） */
const BUDGET_LABEL = "1人あたりの予算";

const asText = (value: string | null | undefined): string => value ?? "";
const asNumberText = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value));
/** 空の欄は項目ごと送らない（入口が「入れてください」と答える。0 に化けさせない）。 */
const asNumber = (value: string): number | undefined => (value.trim() === "" ? undefined : Number(value));

/** 店の情報を取る。断られた・失敗したときは断りをそのまま返す（読み込みの部品が「読めなかった」を出す）。 */
const loadProfile = async (): Promise<StoreProfile | ApiFailure> => {
  const result = await callApi("GET /api/store/profile");
  return isFailure(result) ? result : result.profile;
};

export const ProfileForm = () => {
  // 開いた時に1回だけ取る（離れたあとに返ってきた答えは useLoad が捨てる）。取り直さないので、
  // 後から届いた値が打ち始めた内容を上書きすることも無い。
  const { state, reload } = useLoad(loadProfile);
  return (
    <LoadView state={state} onRetry={() => void reload()}>
      {(profile) => <ProfileFields initial={profile} />}
    </LoadView>
  );
};

/** 読めた店の情報を初めの値にした入力の欄。 */
const ProfileFields = ({ initial }: { initial: StoreProfile }) => {
  const [name, setName] = useState(() => asText(initial.name));
  const [address, setAddress] = useState(() => asText(initial.address));
  const [url, setUrl] = useState(() => asText(initial.url));
  const [genres, setGenres] = useState<string[]>(() => initial.genres);
  const [menus, setMenus] = useState<string[]>(() => initial.menus);
  const [menu, setMenu] = useState("");
  const [budgetMin, setBudgetMin] = useState(() => asNumberText(initial.budgetMin));
  const [budgetMax, setBudgetMax] = useState(() => asNumberText(initial.budgetMax));
  // 送っている間は「保存する」を止め、済んだら role=status で知らせる（2026-09-25 監査の指摘 横断-03）
  const save = useSubmit();
  const failure = save.failure;

  /** 外すのはいつでもできる。足すのは上限まで（画面の側でも止める・下の fieldset の注を参照）。 */
  const toggleGenre = (genre: string) => {
    setGenres((prev) => {
      if (prev.includes(genre)) return prev.filter((g) => g !== genre);
      return prev.length >= STORE_GENRES_MAX ? prev : [...prev, genre];
    });
  };

  const addMenu = () => {
    const value = menu.trim();
    if (value === "") return;
    // 件数の上限はここで止めず、入口に断ってもらう（規則の正本を画面に写さない）。
    setMenus((prev) => [...prev, value]);
    setMenu("");
  };

  /**
   * メニューの欄の Enter は「1件足す」（2026-09-25 監査の指摘 店-17）。フォームの送信（店の情報全体の保存）へ
   * 流さない。日本語の変換を確定する Enter（isComposing・keyCode 229）では何もしない。
   */
  const onMenuKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing || event.keyCode === IME_KEY_CODE) return;
    event.preventDefault();
    addMenu();
  };

  const removeMenu = (index: number) => {
    setMenus((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await save.run(
      () =>
        callApi("PUT /api/store/profile", {
          body: {
            name,
            address,
            url,
            genres,
            menus,
            budgetMin: asNumber(budgetMin),
            budgetMax: asNumber(budgetMax),
          },
        }),
      SUBMIT_TEXTS.profileSaved,
    );
  };

  return (
    <form
      data-testid="form-profile"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {/* 画面の見出し（h1「店舗情報」）はページ（app/store/profile）が出す（横断-11・横断-12） */}
      <p className="store-lead">ここに入れた内容が、席を探している人に出ます。</p>

      <label htmlFor="store-profile-name">店名</label>
      <input
        id="store-profile-name"
        data-testid="field-name"
        type="text"
        value={name}
        maxLength={STORE_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        {...fieldAria("name", failure, "store-profile-name")}
      />
      <FieldMessage inputId="store-profile-name" name="name" failure={failure} ctx={{ field: "店名", min: STORE_NAME_MIN, max: STORE_NAME_MAX }} />

      <label htmlFor="store-profile-address">住所</label>
      <input
        id="store-profile-address"
        data-testid="field-address"
        type="text"
        value={address}
        maxLength={STORE_ADDRESS_MAX}
        onChange={(event) => setAddress(event.target.value)}
        {...fieldAria("address", failure, "store-profile-address", { kinds: ADDRESS_KINDS })}
      />
      <FieldMessage
        inputId="store-profile-address"
        name="address"
        failure={failure}
        kinds={ADDRESS_KINDS}
        ctx={{ field: "住所", min: STORE_ADDRESS_MIN, max: STORE_ADDRESS_MAX }}
      />

      <label htmlFor="store-profile-url">ホームページの URL（任意）</label>
      <input
        id="store-profile-url"
        data-testid="field-url"
        type="url"
        value={url}
        maxLength={STORE_URL_MAX}
        onChange={(event) => setUrl(event.target.value)}
        {...fieldAria("url", failure, "store-profile-url")}
      />
      <FieldMessage inputId="store-profile-url" name="url" failure={failure} ctx={{ field: "ホームページの URL", hint: URL_HINT, max: STORE_URL_MAX }} />

      {/* ⚠️ 上限（3個）は**チェックを付けさせない形**で示す（2026-09-21 の本人の指摘）。
          4つ目を押せてから入口に断られるより、押せないほうが早く分かる。
          下限（1個）と上限そのものの正本は入口——ここは同じ数を schemas/limits から読んで
          見た目に映すだけで、規則を画面に写し取ってはいない。 */}
      <fieldset id="store-profile-genres" className="store-field" {...fieldAria("genres", failure, "store-profile-genres")}>
        <legend>
          ジャンル（{genres.length}/{STORE_GENRES_MAX}・{STORE_GENRES_MIN}〜{STORE_GENRES_MAX}個）
        </legend>
        <div className="store-chips">
          {TEXTS.genres.map((genre) => {
            const checked = genres.includes(genre);
            return (
              <label className="store-chip" key={genre} htmlFor={`store-profile-genre-${genre}`}>
                <input
                  id={`store-profile-genre-${genre}`}
                  data-testid={`genre-${genre}`}
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && genres.length >= STORE_GENRES_MAX}
                  onChange={() => toggleGenre(genre)}
                />
                <span className="store-chip__text">{genre}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <FieldMessage inputId="store-profile-genres" name="genres" failure={failure} ctx={{ field: "ジャンル", min: STORE_GENRES_MIN, max: STORE_GENRES_MAX }} />

      {/* おすすめメニューは**1行1枚の札**にして、名前と「消す」を離す（2026-09-22 の本人の指摘
          「メニュー名と消すボタンが重なっている」）。足す欄とボタンは1行に並べる。 */}
      <label htmlFor="store-profile-menu">
        おすすめメニュー（{menus.length}/{MENUS_MAX}・{MENUS_MAX}件まで）
      </label>
      {menus.length > 0 ? (
        <ul className="store-menu-list">
          {menus.map((item, index) => (
            <li className="store-menu-item" key={`${item}-${index}`}>
              <span className="store-menu-item__mark" aria-hidden="true">
                {index + 1}
              </span>
              <span className="store-menu-item__name">{item}</span>
              <button type="button" className="store-btn store-btn--quiet" onClick={() => removeMenu(index)}>
                消す
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* 1件ずつ足す形（基準 15.6）。1件の長さは打てる字数で抑え、件数の上限は入口が断る（基準 15.7）。 */}
      <div className="store-inline">
        <input
          id="store-profile-menu"
          data-testid="field-menu"
          type="text"
          placeholder="例: 刺身盛り合わせ"
          value={menu}
          minLength={MENU_NAME_MIN}
          maxLength={MENU_NAME_MAX}
          enterKeyHint="enter"
          onChange={(event) => setMenu(event.target.value)}
          onKeyDown={onMenuKeyDown}
          {...fieldAria("menus", failure, "store-profile-menu")}
        />
        <button type="button" className="store-btn store-btn--quiet" data-testid="btn-add-menu" onClick={addMenu}>
          ＋ 足す
        </button>
      </div>
      <FieldMessage inputId="store-profile-menu" name="menus" failure={failure} ctx={{ field: "おすすめメニュー", min: MENU_NAME_MIN, max: MENUS_MAX }} />

      {/* 予算の最低と最高は横に並べる（「〜の最低は最高以下に」の文が、2つの欄を見比べながら読める） */}
      <div className="store-pair">
        <div className="store-field">
          <label htmlFor="store-profile-budget-min">{BUDGET_LABEL}（最低・円）</label>
          <input
            id="store-profile-budget-min"
            data-testid="field-budgetMin"
            type="number"
            inputMode="numeric"
            value={budgetMin}
            min={BUDGET_MAX_MIN}
            max={BUDGET_MAX_MAX}
            onChange={(event) => setBudgetMin(event.target.value)}
            {...fieldAria("budgetMin", failure, "store-profile-budget-min")}
          />
          <FieldMessage inputId="store-profile-budget-min" name="budgetMin" failure={failure} ctx={{ field: BUDGET_LABEL, min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />
        </div>
        <div className="store-field">
          <label htmlFor="store-profile-budget-max">{BUDGET_LABEL}（最高・円）</label>
          <input
            id="store-profile-budget-max"
            data-testid="field-budgetMax"
            type="number"
            inputMode="numeric"
            value={budgetMax}
            min={BUDGET_MAX_MIN}
            max={BUDGET_MAX_MAX}
            onChange={(event) => setBudgetMax(event.target.value)}
            {...fieldAria("budgetMax", failure, "store-profile-budget-max")}
          />
          <FieldMessage inputId="store-profile-budget-max" name="budgetMax" failure={failure} ctx={{ field: BUDGET_LABEL, min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />
        </div>
      </div>

      <SubmitButton type="submit" data-testid="btn-save-profile" busy={save.busy}>
        保存する
      </SubmitButton>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
      <DoneNotice message={save.done} testId="profile-saved" />
    </form>
  );
};

export default ProfileForm;
