"use client";

// 【最終日】店が新しいパスワードを決めるフォーム（要件14の基準 14.14・14.15・14.16）。
// 仮のパスワードで入った店がここへ来る。範囲の外は入口が断り、その文を欄の直下に出したまま
// フォームは開いている（設計書「入力の誤りの出し方」の規則5）。今のパスワードは求めない——
// 仮のパスワードで入った店は、自分で決めた値を覚えていない。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { PASSWORD_MAX, PASSWORD_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["password"];

/** `onChanged` は、決め直したあと呼ぶ側（店のホーム）が表示を取り直すため。 */
export const PasswordForm = ({ onChanged }: { onChanged?: () => void }) => {
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [changed, setChanged] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall("POST", "/api/store/password", { password });
    if (isFailure(result)) {
      setFailure(result);
      setChanged(false);
      return;
    }
    setFailure(null);
    setChanged(true);
    // 決めた値は画面に残さない（見える所に平文を置き続けない）。
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
      <h2>新しいパスワードを決めてください</h2>
      <p>運営から受け取った仮のパスワードは、ここで決めたあと使えなくなります。</p>

      <label htmlFor="store-new-password">新しいパスワード</label>
      <input
        id="store-new-password"
        data-testid="field-password"
        type="password"
        autoComplete="new-password"
        value={password}
        maxLength={PASSWORD_MAX}
        onChange={(event) => setPassword(event.target.value)}
      />
      <FieldMessage name="password" failure={failure} ctx={{ field: "パスワード", min: PASSWORD_MIN, max: PASSWORD_MAX }} />

      <button type="submit" data-testid="btn-change-password">
        パスワードを決める
      </button>
      {changed && <p data-testid="password-changed">パスワードを変えました。次のログインから新しいパスワードを使ってください。</p>}
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
    </form>
  );
};

export default PasswordForm;
