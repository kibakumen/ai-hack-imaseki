"use client";

// 店と運営のログイン（要件14の基準 14.1・14.2）。入口は1つで、通ったあと役割で行き先を分ける。
// 断りはどちらが違うかを言わない1通りの文で、押した操作（ログイン）の直下に出す
// （設計書「入力の誤りの出し方」の規則5。文の正本は domain/texts）。

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { callApi, getPublicConfig, isFailure, type ApiFailure } from "../../lib/client/api";
import { EMAIL_MAX, PASSWORD_MAX } from "../../lib/schemas/limits";
import { HumanCheck, type HumanCheckHandle } from "../ui/HumanCheck";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["email", "password"];
const HOME_BY_ROLE: Record<string, string> = { store: "/store", admin: "/admin" };
/**
 * 仮のパスワードで入った店の行き先（2026-09-25 監査の指摘 安全-21）。決めるまでホームとパスワードの変更しか
 * 使えない（入口が 403 で断る）ので、ホームを経ずに決める画面へ直行させる。
 */
const MUST_CHANGE_PASSWORD_PATH = "/store/password";

/** 通ったあとの行き先。役割で分け、仮のパスワードの店だけは決める画面へ。 */
const destinationAfterLogin = (role: string | undefined, mustChangePassword: boolean | undefined): string => {
  if (role === "store" && mustChangePassword) return MUST_CHANGE_PASSWORD_PATH;
  return HOME_BY_ROLE[role ?? "store"] ?? HOME_BY_ROLE.store;
};

export const LoginForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  // 【最終日】パスワードを忘れた店の申し出先（基準 14.17）。設定に無ければ案内を出さない。
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const humanRef = useRef<HumanCheckHandle | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const config = await getPublicConfig();
      const key = config?.turnstileSiteKey ?? "";
      if (!alive) return;
      setSiteKey(key === "" ? null : key);
      setContactEmail(config?.contactEmail ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleToken = useCallback((token: string) => setHumanToken(token), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await callApi("POST /api/auth/login", { body: { email, password, humanToken } });
    if (isFailure(result)) {
      setFailure(result);
      // 入れたメールアドレスは残す（基準 14.2）。パスワードだけ打ち直してもらう。
      setPassword("");
      setHumanToken(null);
      humanRef.current?.reset();
      return;
    }
    setFailure(null);
    window.location.assign(destinationAfterLogin(result.role, result.mustChangePassword));
  };

  return (
    <form
      data-testid="form-login"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>ログイン</h2>

      <label htmlFor="login-email">メールアドレス</label>
      <input
        id="login-email"
        data-testid="field-email"
        type="email"
        autoComplete="username"
        value={email}
        maxLength={EMAIL_MAX}
        onChange={(event) => setEmail(event.target.value)}
      />
      <FieldMessage name="email" failure={failure} ctx={{ field: "メールアドレス", max: EMAIL_MAX }} />

      <label htmlFor="login-password">パスワード</label>
      <input
        id="login-password"
        data-testid="field-password"
        type="password"
        autoComplete="current-password"
        value={password}
        maxLength={PASSWORD_MAX}
        onChange={(event) => setPassword(event.target.value)}
      />
      <FieldMessage name="password" failure={failure} ctx={{ field: "パスワード", max: PASSWORD_MAX }} />

      {siteKey !== null && <HumanCheck ref={humanRef} siteKey={siteKey} onToken={handleToken} />}

      <button type="submit" data-testid="btn-login">
        ログイン
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />

      {contactEmail !== null && (
        // パスワードを忘れた店が「誰に・どこへ申し出るのか」を知る唯一の場所（基準 14.17）。
        // システムは店へメールを送らないので、運営が仮のパスワードを発行して自分のメールで返す。
        <p>
          パスワードを忘れた場合は、運営へメールでお知らせください: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
      )}
    </form>
  );
};

export default LoginForm;
