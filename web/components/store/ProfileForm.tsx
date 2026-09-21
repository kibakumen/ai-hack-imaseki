"use client";

// 店の情報の入力（要件15の基準 15.1〜15.12）。打つ欄は6つ（店名・住所・ホームページの URL・
// ジャンル・おすすめメニュー・1人あたりの予算の幅）。値段やアレルゲンつきの提供メニューの欄と、
// 1つの値の目安料金の欄は持たない（基準 15.12）。
//
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる（設計書「入力の誤りの出し方」の
// 規則5）。断られても打った6項目はそのまま残す——住所が位置に直せなかったときに、
// 全部打ち直させないため（基準 15.10 の「入れ直すかやり直す」）。

import { useEffect, useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { TEXTS } from "../../lib/domain/texts";
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
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const PROFILE_PATH = "/api/store/profile";
const FIELD_NAMES = ["name", "address", "url", "genres", "menus", "budgetMin", "budgetMax"];
/** 住所の欄は、形の誤りだけでなく「位置に直せなかった」も直下に出す（基準 15.10）。 */
const ADDRESS_KINDS = ["address_unresolved"];
const URL_HINT = "http:// か https:// で始まる形";
/** 予算の2つの欄は同じ呼び名にする（「〜の最低は最高以下に」の文がそのまま読めるように） */
const BUDGET_LABEL = "1人あたりの予算";

/** GET /api/store/profile が返す中身。まだ入れていない項目は空か null。 */
type LoadedProfile = {
  name?: string | null;
  address?: string | null;
  url?: string | null;
  genres?: string[] | null;
  menus?: string[] | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
};

const asText = (value: string | null | undefined): string => value ?? "";
const asList = (value: string[] | null | undefined): string[] => value ?? [];
const asNumberText = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value));
/** 空の欄は項目ごと送らない（入口が「入れてください」と答える。0 に化けさせない）。 */
const asNumber = (value: string): number | undefined => (value.trim() === "" ? undefined : Number(value));

export const ProfileForm = () => {
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [url, setUrl] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [menus, setMenus] = useState<string[]>([]);
  const [menu, setMenu] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiCall<{ profile?: LoadedProfile }>("GET", PROFILE_PATH);
      if (!alive) return;
      const profile = isFailure(result) ? null : result.profile;
      if (profile) {
        setName(asText(profile.name));
        setAddress(asText(profile.address));
        setUrl(asText(profile.url));
        setGenres(asList(profile.genres));
        setMenus(asList(profile.menus));
        setBudgetMin(asNumberText(profile.budgetMin));
        setBudgetMax(asNumberText(profile.budgetMax));
      }
      // 取れなくても欄は出す（入れ直して保存できる）。読み込みが済むまで欄を出さないのは、
      // 後から届いた値が、打ち始めた内容を上書きしないようにするため。
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggleGenre = (genre: string) => {
    setGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]));
  };

  const addMenu = () => {
    const value = menu.trim();
    if (value === "") return;
    // 件数の上限はここで止めず、入口に断ってもらう（規則の正本を画面に写さない）。
    setMenus((prev) => [...prev, value]);
    setMenu("");
  };

  const removeMenu = (index: number) => {
    setMenus((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall("PUT", PROFILE_PATH, {
      name,
      address,
      url,
      genres,
      menus,
      budgetMin: asNumber(budgetMin),
      budgetMax: asNumber(budgetMax),
    });
    if (isFailure(result)) {
      setFailure(result);
      setSaved(false);
      return;
    }
    setFailure(null);
    setSaved(true);
  };

  if (!loaded) return <p>読み込み中です。</p>;

  return (
    <form
      data-testid="form-profile"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>お店の情報</h2>
      <p>ここに入れた内容が、席を探している人に出ます。</p>

      <label htmlFor="store-profile-name">店名</label>
      <input
        id="store-profile-name"
        data-testid="field-name"
        type="text"
        value={name}
        maxLength={STORE_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
      />
      <FieldMessage name="name" failure={failure} ctx={{ field: "店名", min: STORE_NAME_MIN, max: STORE_NAME_MAX }} />

      <label htmlFor="store-profile-address">住所</label>
      <input
        id="store-profile-address"
        data-testid="field-address"
        type="text"
        value={address}
        maxLength={STORE_ADDRESS_MAX}
        onChange={(event) => setAddress(event.target.value)}
      />
      <FieldMessage
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
      />
      <FieldMessage name="url" failure={failure} ctx={{ field: "ホームページの URL", hint: URL_HINT, max: STORE_URL_MAX }} />

      <fieldset>
        <legend>ジャンル（{STORE_GENRES_MIN}〜{STORE_GENRES_MAX}個）</legend>
        {TEXTS.genres.map((genre) => (
          <label key={genre} htmlFor={`store-profile-genre-${genre}`}>
            <input
              id={`store-profile-genre-${genre}`}
              data-testid={`genre-${genre}`}
              type="checkbox"
              checked={genres.includes(genre)}
              onChange={() => toggleGenre(genre)}
            />
            {genre}
          </label>
        ))}
      </fieldset>
      <FieldMessage name="genres" failure={failure} ctx={{ field: "ジャンル", min: STORE_GENRES_MIN, max: STORE_GENRES_MAX }} />

      <label htmlFor="store-profile-menu">おすすめメニュー（{MENUS_MAX}件まで）</label>
      <ul>
        {menus.map((item, index) => (
          <li key={`${item}-${index}`}>
            {item}
            <button type="button" onClick={() => removeMenu(index)}>
              消す
            </button>
          </li>
        ))}
      </ul>
      {/* 1件ずつ足す形（基準 15.6）。1件の長さは打てる字数で抑え、件数の上限は入口が断る（基準 15.7）。 */}
      <input
        id="store-profile-menu"
        data-testid="field-menu"
        type="text"
        value={menu}
        minLength={MENU_NAME_MIN}
        maxLength={MENU_NAME_MAX}
        onChange={(event) => setMenu(event.target.value)}
      />
      <button type="button" data-testid="btn-add-menu" onClick={addMenu}>
        メニューを足す
      </button>
      <FieldMessage name="menus" failure={failure} ctx={{ field: "おすすめメニュー", min: MENU_NAME_MIN, max: MENUS_MAX }} />

      <label htmlFor="store-profile-budget-min">{BUDGET_LABEL}（最低）</label>
      <input
        id="store-profile-budget-min"
        data-testid="field-budgetMin"
        type="number"
        value={budgetMin}
        min={BUDGET_MAX_MIN}
        max={BUDGET_MAX_MAX}
        onChange={(event) => setBudgetMin(event.target.value)}
      />
      <FieldMessage name="budgetMin" failure={failure} ctx={{ field: BUDGET_LABEL, min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />

      <label htmlFor="store-profile-budget-max">{BUDGET_LABEL}（最高）</label>
      <input
        id="store-profile-budget-max"
        data-testid="field-budgetMax"
        type="number"
        value={budgetMax}
        min={BUDGET_MAX_MIN}
        max={BUDGET_MAX_MAX}
        onChange={(event) => setBudgetMax(event.target.value)}
      />
      <FieldMessage name="budgetMax" failure={failure} ctx={{ field: BUDGET_LABEL, min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />

      <button type="submit" data-testid="btn-save-profile">
        保存する
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
      {saved && <p data-testid="profile-saved">保存しました。</p>}
    </form>
  );
};

export default ProfileForm;
