"use client";

// 「メールアドレスはまだ確認されていません」の帯（2026-09-22 追加・feat/email-verify）。
// 店のホームが `emailVerified === false` のときだけ出す——メールを送る口が無い公開先では応答に
// この項目そのものが無いので、帯は1度も出ない（鍵を外せば表示が消えるだけで元に戻る）。
// 何もブロックしない。登録したアドレスを入れて「確認メールを送る」を押すと、入口がそのアドレスへ
// 確認のリンクを送る（保存と違うアドレスは入口が断る＝別のアドレスへ送る道にしない）。
// 断りの語は読まない——描くのは components/ui/InputRefusal だけ。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { EMAIL_MAX } from "../../lib/schemas/limits";
import { FieldKindMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["email"];

type Props = {
  /** 叩く入口。店は `/api/store/email/verify`、運営は `/api/admin/email/verify`。 */
  endpoint: string;
};

export const EmailVerifyBanner = ({ endpoint }: Props) => {
  const [email, setEmail] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const result = await apiCall("POST", endpoint, { email });
    setBusy(false);
    if (isFailure(result)) {
      setFailure(result);
      setSent(false);
      return;
    }
    setFailure(null);
    setSent(true);
  };

  return (
    <section className="status-banner" role="status" data-testid="email-verify-banner">
      <p>メールアドレスはまだ確認されていません。確認しなくても今までどおり使えます。</p>
      {sent ? (
        <p data-testid="email-verify-sent">確認メールを送りました。届いたメールのリンクを24時間以内に開いてください。</p>
      ) : (
        <form
          data-testid="form-email-verify"
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor="email-verify-address">登録したメールアドレス</label>
          <input
            id="email-verify-address"
            data-testid="field-email-verify"
            type="email"
            autoComplete="email"
            value={email}
            maxLength={EMAIL_MAX}
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldKindMessage name="email" failure={failure} />
          <button type="submit" data-testid="btn-email-verify" disabled={busy}>
            確認メールを送る
          </button>
          <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
        </form>
      )}
    </section>
  );
};

export default EmailVerifyBanner;
