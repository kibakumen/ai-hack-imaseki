"use client";

// 【最終日】店が新しいパスワードを決めるフォーム（要件14の基準 14.14・14.15・14.16）。
// 仮のパスワードで入った店がここへ来る。範囲の外は入口が断り、その文を欄の直下に出したまま
// フォームは開いている（設計書「入力の誤りの出し方」の規則5）。今のパスワードは求めない——
// 仮のパスワードで入った店は、自分で決めた値を覚えていない。
//
// 2026-09-22 追加: 運営が自分のパスワードを決め直す場面でも同じ部品を使う（`endpoint` と
// `requireCurrent`）。運営には仮のパスワードの場面が無いので、今のパスワードの再入力を求める。
// 既定（引数なし）は仮のパスワードの店の場面のままで、受け入れ検査 r14 が描く形は変えていない。
//
// 2026-09-25（監査の指摘 安全-07）: 店の入口も、仮のパスワードの直後でなければ今のパスワードを求める。
// 店の画面（StorePasswordPanel）がホームの印を見て `requireCurrent` を渡す。

import { useState, type FormEvent } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { PASSWORD_MAX, PASSWORD_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { DoneNotice, SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";

/** 今のパスワードが合わない断りは、欄の直下に語の文で出す */
const MISMATCH_KINDS = ["password_mismatch"];

type Props = {
  /** 決め直したあと呼ぶ側（店のホーム）が表示を取り直すため。 */
  onChanged?: () => void;
  /** 叩く入口。既定は店の入口。運営の画面は `/api/admin/password` を渡す。 */
  endpoint?: "/api/store/password" | "/api/admin/password";
  /** 今のパスワードの再入力を求めるか。仮のパスワードで入った店には求めない（既定 false）。 */
  requireCurrent?: boolean;
};

export const PasswordForm = ({ onChanged, endpoint = "/api/store/password", requireCurrent = false }: Props) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  // 送っている間は押せない（2026-09-25 監査の指摘 横断-03）
  const change = useSubmit();
  const failure = change.failure;
  const [changed, setChanged] = useState(false);

  const fieldNames = requireCurrent ? ["currentPassword", "password"] : ["password"];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await change.run(() => callApi(`POST ${endpoint}` as const, { body: requireCurrent ? { currentPassword, password } : { password } }));
    if (result === null) return;
    if (isFailure(result)) {
      setChanged(false);
      return;
    }
    setChanged(true);
    // 決めた値は画面に残さない（見える所に平文を置き続けない）。
    setCurrentPassword("");
    setPassword("");
    onChanged?.();
  };

  return (
    <form
      data-testid="form-password"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>{requireCurrent ? "パスワードを変える" : "新しいパスワードを決めてください"}</h2>
      {requireCurrent ? (
        <p>確かめのため、今のパスワードも入れてください。</p>
      ) : (
        <p>運営から受け取った仮のパスワードは、ここで決めたあと使えなくなります。</p>
      )}

      {requireCurrent && (
        <>
          <label htmlFor="current-password">今のパスワード</label>
          <input
            id="current-password"
            data-testid="field-currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            maxLength={PASSWORD_MAX}
            onChange={(event) => setCurrentPassword(event.target.value)}
            {...fieldAria("currentPassword", failure, "current-password", { kinds: MISMATCH_KINDS })}
          />
          <FieldMessage name="currentPassword" inputId="current-password" failure={failure} ctx={{ field: "今のパスワード" }} kinds={MISMATCH_KINDS} />
        </>
      )}

      <label htmlFor="store-new-password">新しいパスワード</label>
      <input
        id="store-new-password"
        data-testid="field-password"
        type="password"
        autoComplete="new-password"
        value={password}
        maxLength={PASSWORD_MAX}
        onChange={(event) => setPassword(event.target.value)}
        {...fieldAria("password", failure, "store-new-password")}
      />
      <FieldMessage name="password" inputId="store-new-password" failure={failure} ctx={{ field: "パスワード", min: PASSWORD_MIN, max: PASSWORD_MAX }} />

      <SubmitButton type="submit" data-testid="btn-change-password" busy={change.busy}>
        {requireCurrent ? "パスワードを変える" : "パスワードを決める"}
      </SubmitButton>
      <DoneNotice message={changed ? "パスワードを変えました。次のログインから新しいパスワードを使ってください。" : null} testId="password-changed" />
      <FormMessage failure={failure} fieldNames={fieldNames} />
    </form>
  );
};

export default PasswordForm;
