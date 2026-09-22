"use client";

// ログインのメールアドレスを変えるフォーム（2026-09-22 追加・店と運営で同じ部品）。
// 確認メールを送らない設計なので、代わりに今のパスワードを入れさせて本人を確かめる。
// 断りは欄の直下に出したままフォームは開いている（設計書「入力の誤りの出し方」の規則5）——
// 重複（email_taken）はメールアドレスの欄の直下、今のパスワードが合わない（password_mismatch）は
// その欄の直下。文の正本は domain/texts で、この部品は語を読まない。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { EMAIL_MAX, PASSWORD_MAX } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["email", "currentPassword"];

type Props = {
  /** 叩く入口。店は `/api/store/email`、運営は `/api/admin/email`。 */
  endpoint: string;
  /** 変えたあと呼ぶ側が表示を取り直すため。 */
  onChanged?: () => void;
};

export const EmailForm = ({ endpoint, onChanged }: Props) => {
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [changedTo, setChangedTo] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall("POST", endpoint, { email, currentPassword });
    if (isFailure(result)) {
      setFailure(result);
      setChangedTo(null);
      return;
    }
    setFailure(null);
    setChangedTo(email);
    // パスワードは画面に残さない。新しいアドレスは「次からこれで入る」と見せるため残す。
    setCurrentPassword("");
    onChanged?.();
  };

  return (
    <form
      data-testid="form-email"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>メールアドレスを変える</h2>
      <p>次のログインから新しいメールアドレスを使います。確かめのため、今のパスワードも入れてください。</p>

      <label htmlFor="account-new-email">新しいメールアドレス</label>
      <input
        id="account-new-email"
        data-testid="field-email"
        type="email"
        autoComplete="email"
        value={email}
        maxLength={EMAIL_MAX}
        onChange={(event) => setEmail(event.target.value)}
      />
      <FieldMessage name="email" failure={failure} ctx={{ field: "メールアドレス", hint: "name@example.com の形", max: EMAIL_MAX }} kinds={["email_taken"]} />

      <label htmlFor="account-current-password">今のパスワード</label>
      <input
        id="account-current-password"
        data-testid="field-currentPassword"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        maxLength={PASSWORD_MAX}
        onChange={(event) => setCurrentPassword(event.target.value)}
      />
      <FieldMessage name="currentPassword" failure={failure} ctx={{ field: "今のパスワード" }} kinds={["password_mismatch"]} />

      <button type="submit" data-testid="btn-change-email">
        メールアドレスを変える
      </button>
      {changedTo !== null && <p data-testid="email-changed">メールアドレスを {changedTo} に変えました。次のログインからこのアドレスを使ってください。</p>}
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
    </form>
  );
};

export default EmailForm;
