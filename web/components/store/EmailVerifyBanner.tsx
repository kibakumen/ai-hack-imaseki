"use client";

// 「メールアドレスはまだ確認されていません」の帯（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ）。
// 店のホームが `emailVerified === false` のときだけ出す——メールを送る口が無い公開先では応答に
// この項目そのものが無いので、帯は1度も出ない（鍵を外せば表示が消えるだけで元に戻る）。
// 何もブロックしない。登録したアドレスを入れて「確認メールを送る」を押すと、入口がそのアドレスへ
// 確認のリンクを送る（保存と違うアドレスは入口が email_mismatch で断る＝別のアドレスへ送る道にしない）。
// 断りの語は読まない——描くのは components/ui/InputRefusal だけ。送っている間は押せない（横断-03・useSubmit）。

import { useState, type FormEvent } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { EMAIL_MAX } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { DoneNotice, SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";

const FIELD_NAMES = ["email"];
/** 欄の直下に語の文で出す、項目に結びつけた規則の断り */
const EMAIL_KINDS = ["email_mismatch"];
const INPUT_ID = "email-verify-address";

type Props = {
  /** 叩く入口の鍵。店は `POST /api/store/email/verify`、運営は `POST /api/admin/email/verify`。 */
  endpoint: "POST /api/store/email/verify" | "POST /api/admin/email/verify";
};

export const EmailVerifyBanner = ({ endpoint }: Props) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const send = useSubmit();
  const failure = send.failure;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await send.run(() => callApi(endpoint, { body: { email } }));
    if (result === null) return;
    setSent(!isFailure(result));
  };

  return (
    <section className="status-banner" aria-label="メールアドレスの確認" data-testid="email-verify-banner">
      <p className="status-banner__lead">メールアドレスはまだ確認されていません。確認しなくても今までどおり使えます。</p>
      <DoneNotice message={sent ? "確認メールを送りました。届いたメールのリンクを24時間以内に開いてください。" : null} testId="email-verify-sent" />
      {!sent && (
        <form
          data-testid="form-email-verify"
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor={INPUT_ID}>登録したメールアドレス</label>
          <input
            id={INPUT_ID}
            data-testid="field-email-verify"
            type="email"
            autoComplete="email"
            value={email}
            maxLength={EMAIL_MAX}
            onChange={(event) => setEmail(event.target.value)}
            {...fieldAria("email", failure, INPUT_ID, { kinds: EMAIL_KINDS })}
          />
          <FieldMessage name="email" inputId={INPUT_ID} failure={failure} ctx={{ field: "メールアドレス", hint: "name@example.com の形", max: EMAIL_MAX }} kinds={EMAIL_KINDS} />
          <SubmitButton type="submit" data-testid="btn-email-verify" busy={send.busy}>
            確認メールを送る
          </SubmitButton>
          <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
        </form>
      )}
    </section>
  );
};

export default EmailVerifyBanner;
