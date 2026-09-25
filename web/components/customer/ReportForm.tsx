"use client";

// 通報の入力（要件26の基準 26.2・26.3・26.5・26.19）。送る前に自分では検査せず、入口が返した断りを
// InputRefusal に描かせる（設計書「入力の誤りの出し方」の規則5）。字数の属性は打ち間違いを減らす
// 補助で、正本ではない。
//
// 断りの出し場所は2つに分かれる（設計書「入力の誤りの出し方」の 26.3・26.19 の行）:
//   `reason` の断り（required・too_long） … 欄の直下（FieldMessage）。書いた理由はそのまま残る
//   その店へは通報できない（report_not_allowed） … 「送る」の直下（FormMessage）

import { useState, type FormEvent } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { SUBMIT_TEXTS } from "../../lib/domain/texts";
import { REPORT_REASON_MAX, REPORT_REASON_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";

const FIELD_NAMES = ["reason"];
const REASON_CTX = { field: "理由", min: REPORT_REASON_MIN, max: REPORT_REASON_MAX };

export type ReportTarget = { storeId: string; storeName: string };

type Props = ReportTarget & { onClose: () => void };

/**
 * 送れたあと（2026-09-25 監査の指摘 横断-03）。欄と「送る」を畳み、送れたことだけを出す——それまでは送ったあとも
 * 「送る」が押せ、同じ通報が重ねて届いた（運営が通報の件数を読み違える）。
 */
const ReportSent = ({ storeName, onClose }: { storeName: string; onClose: () => void }) => (
  <section className="report-sent" aria-label={`${storeName}の通報`}>
    <p className="done-notice" role="status" data-testid="report-sent">
      {SUBMIT_TEXTS.reportSent}
    </p>
    <button type="button" onClick={onClose}>
      閉じる
    </button>
  </section>
);

export const ReportForm = ({ storeId, storeName, onClose }: Props) => {
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const report = useSubmit();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await report.run(() => callApi("POST /api/customer/reports", { body: { storeId, reason } }));
    if (result !== null && !isFailure(result)) setSent(true);
  };

  if (sent) return <ReportSent storeName={storeName} onClose={onClose} />;

  return (
    <form
      data-testid="form-report"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>{storeName}を運営に知らせる</h2>
      <p>見過ごせないことがあれば、運営へ知らせてください。返事はできませんが、緊急のときは運営が店の登録を取り消します。</p>

      <label htmlFor="report-reason">どんなことがありましたか</label>
      <textarea
        id="report-reason"
        data-testid="field-reason"
        rows={4}
        value={reason}
        maxLength={REPORT_REASON_MAX}
        onChange={(event) => setReason(event.target.value)}
        {...fieldAria("reason", report.failure, "report-reason")}
      />
      <FieldMessage inputId="report-reason" name="reason" failure={report.failure} ctx={REASON_CTX} />

      <SubmitButton type="submit" data-testid="btn-send-report" busy={report.busy}>
        送る
      </SubmitButton>
      <FormMessage failure={report.failure} fieldNames={FIELD_NAMES} />

      <button type="button" onClick={onClose}>
        閉じる
      </button>
    </form>
  );
};

export default ReportForm;
