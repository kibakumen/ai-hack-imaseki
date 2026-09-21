"use client";

// 通報の入力（要件26の基準 26.2・26.3・26.5・26.19）。送る前に自分では検査せず、入口が返した断りを
// InputRefusal に描かせる（設計書「入力の誤りの出し方」の規則5）。字数の属性は打ち間違いを減らす
// 補助で、正本ではない。
//
// 断りの出し場所は2つに分かれる（設計書「入力の誤りの出し方」の 26.3・26.19 の行）:
//   `reason` の断り（required・too_long） … 欄の直下（FieldMessage）。書いた理由はそのまま残る
//   その店へは通報できない（report_not_allowed） … 「送る」の直下（FormMessage）

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { REPORT_REASON_MAX, REPORT_REASON_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const FIELD_NAMES = ["reason"];
const REASON_CTX = { field: "理由", min: REPORT_REASON_MIN, max: REPORT_REASON_MAX };

export type ReportTarget = { storeId: string; storeName: string };

type Props = ReportTarget & { onClose: () => void };

export const ReportForm = ({ storeId, storeName, onClose }: Props) => {
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall("POST", "/api/customer/reports", { storeId, reason });
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    setFailure(null);
    setSent(true);
  };

  return (
    <form
      data-testid="form-report"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>{storeName}を運営に知らせる</h2>
      <p>見過ごせないことがあれば、運営へ知らせてください。返事はできませんが、緊急のときは運営が店を止めます。</p>

      <label htmlFor="report-reason">どんなことがありましたか</label>
      <textarea
        id="report-reason"
        data-testid="field-reason"
        rows={4}
        value={reason}
        maxLength={REPORT_REASON_MAX}
        onChange={(event) => setReason(event.target.value)}
      />
      <FieldMessage name="reason" failure={failure} ctx={REASON_CTX} />

      <button type="submit" data-testid="btn-send-report">
        送る
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />

      {sent && <p data-testid="report-sent">運営に知らせました。ありがとうございます。</p>}

      <button type="button" onClick={onClose}>
        閉じる
      </button>
    </form>
  );
};

export default ReportForm;
