"use client";

// 客の登録の入力（要件1の基準 1.1〜1.7・1.10）。打つ欄は4つだけで、自由記述とアレルギーの欄は
// 持たない（基準 1.5）。送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる
// （設計書「入力の誤りの出し方」の規則5）。入力欄の属性は打ち間違いを減らす補助で、正本ではない。

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiCall, getPublicConfig, isFailure, type ApiFailure } from "../../lib/client/api";
import { TEXTS } from "../../lib/domain/texts";
import { BUDGET_MAX_MAX, BUDGET_MAX_MIN, NICKNAME_MAX, NICKNAME_MIN, PHONE_MAX_LENGTH } from "../../lib/schemas/limits";
import { HumanCheck, type HumanCheckHandle } from "../ui/HumanCheck";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["nickname", "phone", "genres", "budgetMax"];
const PHONE_HINT = "数字10桁か11桁";

/**
 * 空欄は未指定（null）。数にならない文字はそのまま送り、判定は入口の検査に任せる
 * （画面は送る前に自分で検査しない・設計書の規則5）。
 */
const budgetToSend = (raw: string): number | string | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isNaN(value) ? trimmed : value;
};

export const RegisterForm = ({ onRegistered }: { onRegistered: () => void }) => {
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [budgetMax, setBudgetMax] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const humanRef = useRef<HumanCheckHandle | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const config = await getPublicConfig();
      const key = config?.turnstileSiteKey ?? "";
      // 取れなかったときは確かめの部品を描かない。送るボタンは押せるままで、押せば断りが出る。
      if (alive) setSiteKey(key === "" ? null : key);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleToken = useCallback((token: string) => setHumanToken(token), []);

  const toggleGenre = (genre: string) =>
    setGenres((current) => (current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre]));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall("POST", "/api/register/customer", {
      nickname,
      phone,
      genres,
      budgetMax: budgetToSend(budgetMax),
      humanToken,
    });
    if (isFailure(result)) {
      setFailure(result);
      // 確かめの値は使い切り。次に送るときのために、その場で取り直す。
      setHumanToken(null);
      humanRef.current?.reset();
      return;
    }
    setFailure(null);
    onRegistered();
  };

  return (
    <form
      data-testid="form-register"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>はじめに登録します</h2>
      <p>一度だけ入れておくと、探すたびに入れ直さずに済みます。</p>

      <label htmlFor="register-nickname">呼び名</label>
      <input
        id="register-nickname"
        data-testid="field-nickname"
        type="text"
        value={nickname}
        maxLength={NICKNAME_MAX}
        onChange={(event) => setNickname(event.target.value)}
      />
      <FieldMessage name="nickname" failure={failure} ctx={{ field: "呼び名", min: NICKNAME_MIN, max: NICKNAME_MAX }} />

      <label htmlFor="register-phone">電話番号</label>
      <input
        id="register-phone"
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

      <label htmlFor="register-budget">1人あたりの予算の上限（任意）</label>
      <input
        id="register-budget"
        data-testid="field-budgetMax"
        type="number"
        inputMode="numeric"
        min={BUDGET_MAX_MIN}
        max={BUDGET_MAX_MAX}
        value={budgetMax}
        onChange={(event) => setBudgetMax(event.target.value)}
      />
      <FieldMessage name="budgetMax" failure={failure} ctx={{ field: "予算の上限", min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />

      {siteKey !== null && <HumanCheck ref={humanRef} siteKey={siteKey} onToken={handleToken} />}

      <button type="submit" data-testid="btn-register">
        登録する
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
    </form>
  );
};

export default RegisterForm;
