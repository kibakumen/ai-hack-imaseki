"use client";

// 客の登録の変更（要件1の基準 1.9【最終日】）。登録のときと同じ4項目を、今の値を初期値にして
// 出し直す。送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる
// （設計書「入力の誤りの出し方」の規則5）。人かどうかの確かめは付けない——確かめつきの入口は
// 登録とログインの3つだけ（設計書「入口の一覧」）で、ここは識別子を持つ客しか通れない。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { TEXTS } from "../../lib/domain/texts";
import { BUDGET_MAX_MAX, BUDGET_MAX_MIN, NICKNAME_MAX, NICKNAME_MIN, PHONE_MAX_LENGTH } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["nickname", "phone", "genres", "budgetMax"];
const PHONE_HINT = "数字10桁か11桁";

export type CustomerProfileValues = { nickname: string; phone: string; genres: string[]; budgetMax: number | null };

/** 空欄は未指定（null）。数にならない文字はそのまま送り、判定は入口の検査に任せる。 */
const budgetToSend = (raw: string): number | string | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isNaN(value) ? trimmed : value;
};

type ProfileSettingsProps = {
  /** 今の登録（ホームの入口が返した値）。 */
  profile: CustomerProfileValues;
  /** 変えられたあと、呼ぶ側がホームを読み直すため。 */
  onSaved?: (profile: CustomerProfileValues) => void;
};

export const ProfileSettings = ({ profile, onSaved }: ProfileSettingsProps) => {
  const [nickname, setNickname] = useState(profile.nickname);
  const [phone, setPhone] = useState(profile.phone);
  const [genres, setGenres] = useState<string[]>(profile.genres);
  const [budgetMax, setBudgetMax] = useState(profile.budgetMax === null ? "" : String(profile.budgetMax));
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);

  const toggleGenre = (genre: string) =>
    setGenres((current) => (current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre]));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall<{ profile: CustomerProfileValues }>("PATCH", "/api/customer/profile", {
      nickname,
      phone,
      genres,
      budgetMax: budgetToSend(budgetMax),
    });
    if (isFailure(result)) {
      setFailure(result);
      setSaved(false);
      return;
    }
    setFailure(null);
    setSaved(true);
    onSaved?.(result.profile);
  };

  return (
    <form
      data-testid="form-profile"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>登録の変更</h2>

      <label htmlFor="profile-nickname">呼び名</label>
      <input
        id="profile-nickname"
        data-testid="field-nickname"
        type="text"
        value={nickname}
        maxLength={NICKNAME_MAX}
        onChange={(event) => setNickname(event.target.value)}
      />
      <FieldMessage name="nickname" failure={failure} ctx={{ field: "呼び名", min: NICKNAME_MIN, max: NICKNAME_MAX }} />

      <label htmlFor="profile-phone">電話番号</label>
      <input
        id="profile-phone"
        data-testid="field-phone"
        type="tel"
        inputMode="numeric"
        value={phone}
        maxLength={PHONE_MAX_LENGTH}
        onChange={(event) => setPhone(event.target.value)}
      />
      <FieldMessage name="phone" failure={failure} ctx={{ field: "電話番号", hint: PHONE_HINT }} />

      <fieldset data-testid="field-genres">
        <legend>好みのジャンル（いくつでも・選ばなくてもかまいません）</legend>
        {TEXTS.genres.map((genre) => (
          <label key={genre}>
            <input type="checkbox" data-testid={`genre-${genre}`} checked={genres.includes(genre)} onChange={() => toggleGenre(genre)} />
            {genre}
          </label>
        ))}
      </fieldset>
      <FieldMessage name="genres" failure={failure} ctx={{ field: "好みのジャンル" }} />

      <label htmlFor="profile-budget">1人あたりの予算の上限（任意）</label>
      <input
        id="profile-budget"
        data-testid="field-budgetMax"
        type="number"
        inputMode="numeric"
        min={BUDGET_MAX_MIN}
        max={BUDGET_MAX_MAX}
        value={budgetMax}
        onChange={(event) => setBudgetMax(event.target.value)}
      />
      <FieldMessage name="budgetMax" failure={failure} ctx={{ field: "予算の上限", min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />

      <button type="submit" data-testid="btn-save-profile">
        変更を保存する
      </button>
      {saved && <p data-testid="profile-saved">変更を保存しました。</p>}
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
    </form>
  );
};

export default ProfileSettings;
