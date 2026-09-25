"use client";

// 店の登録の入力（要件12の基準 12.1〜12.5）。打つ欄は3つ（店名・メールアドレス・パスワード）。
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる（設計書「入力の誤りの出し方」の規則5）。
// 断られたら、店名とメールアドレスは残す。パスワードを消すのは、パスワードの欄の断りと人の確かめの断りの
// ときだけ（2026-09-25 監査の指摘 店-20）——別の欄の断りでも消していたので、打ち直しのたびに打ち間違いが
// 入り込み、登録の直後はログインした状態のまま気づけず、翌日入れなくなって運営に頼むしかなかった。
// 同じ理由で、字数の案内と「パスワードを表示」の切り替えを置く（システムはメールを送らないので自力で戻れない）。

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { callApi, getPublicConfig, isFailure, type ApiFailure } from "../../lib/client/api";
import { EMAIL_MAX, HUMAN_CHECK_ACTIONS, PASSWORD_MAX, PASSWORD_MIN, STORE_NAME_MAX, STORE_NAME_MIN } from "../../lib/schemas/limits";
import { HumanCheck, type HumanCheckHandle } from "../ui/HumanCheck";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["name", "email", "password"];
/**
 * メールアドレスの欄は、形の誤りだけでなく「もう登録されている」も直下に出す（要件12の基準 12.2）。
 * 入口は 409 で `kind` に登録済みの語を、`fields` に `email`／`not_allowed` を返す。ここを渡さないと
 * 項目の出し口は理由（not_allowed）の文しか描かず、操作の出し口は「この項目の断りが在る」と何も描かない
 * ——どちらの経路からも `kind` の文が画面に出なかった（2026-09-22 タスク25 が直した）。
 */
const EMAIL_KINDS = ["email_taken"];
const EMAIL_HINT = "メールアドレスの形";
const PASSWORD_HINT_ID = "store-register-password-hint";

/** 断りのあとパスワードを消すか。パスワードの欄の断りと、人の確かめの断り（入れ直しを求める場面）だけ。 */
const shouldClearPassword = (failure: ApiFailure): boolean =>
  failure.error?.kind === "human_check_failed" || (failure.error?.fields ?? []).some((field) => field.name === "password");
/** 登録が済んだら店のホームへ（画面の遷移は1本だけ・呼ぶ側に渡さない） */
const STORE_HOME_PATH = "/store";

export const RegisterForm = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await callApi("POST /api/register/store", { body: { name, email, password, humanToken } });
    if (isFailure(result)) {
      setFailure(result);
      if (shouldClearPassword(result)) setPassword("");
      // 確かめの値は使い切り。次に送るときのために、その場で取り直す。
      setHumanToken(null);
      humanRef.current?.reset();
      return;
    }
    setFailure(null);
    window.location.assign(STORE_HOME_PATH);
  };

  return (
    <form
      data-testid="form-register"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>お店を登録します</h2>
      <p>登録したあと、運営の承認を待ってからオファーを公開できます。</p>

      <label htmlFor="store-register-name">店名</label>
      <input
        id="store-register-name"
        data-testid="field-name"
        type="text"
        value={name}
        maxLength={STORE_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
      />
      <FieldMessage name="name" failure={failure} ctx={{ field: "店名", min: STORE_NAME_MIN, max: STORE_NAME_MAX }} />

      <label htmlFor="store-register-email">メールアドレス</label>
      <input
        id="store-register-email"
        data-testid="field-email"
        type="email"
        autoComplete="email"
        value={email}
        maxLength={EMAIL_MAX}
        onChange={(event) => setEmail(event.target.value)}
      />
      <FieldMessage name="email" failure={failure} kinds={EMAIL_KINDS} ctx={{ field: "メールアドレス", hint: EMAIL_HINT, max: EMAIL_MAX }} />

      <label htmlFor="store-register-password">パスワード</label>
      <input
        id="store-register-password"
        data-testid="field-password"
        type={showPassword ? "text" : "password"}
        autoComplete="new-password"
        aria-describedby={PASSWORD_HINT_ID}
        value={password}
        maxLength={PASSWORD_MAX}
        onChange={(event) => setPassword(event.target.value)}
      />
      <p id={PASSWORD_HINT_ID} className="field-hint" data-testid="hint-password">
        {PASSWORD_MIN}〜{PASSWORD_MAX}字。次からのログインに使います（忘れると運営に頼んで決め直すことになります）。
      </p>
      <label className="show-password">
        <input type="checkbox" data-testid="toggle-show-password" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
        パスワードを表示
      </label>
      <FieldMessage name="password" failure={failure} ctx={{ field: "パスワード", min: PASSWORD_MIN, max: PASSWORD_MAX }} />

      {siteKey !== null && <HumanCheck ref={humanRef} siteKey={siteKey} action={HUMAN_CHECK_ACTIONS.registerStore} onToken={handleToken} />}

      <button type="submit" data-testid="btn-register">
        登録する
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
    </form>
  );
};

export default RegisterForm;
