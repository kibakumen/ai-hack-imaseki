"use client";

// 【最終日】仮のパスワードの発行（基準 14.10〜14.13）。2026-09-22 に画面から呼ぶ道を足した。
//
// 2026-09-25 監査の指摘 運営-01 の案3: 発行の前に**運営自身の今のパスワード**を入れさせる
// （運営のセッションを盗まれただけで店を乗っ取り、客の電話番号を読めないように）。
// 運営-13: 断りはこの操作の欄の中にだけ出す（ほかの操作と共有しない）。「やめる」で断りも消す。

import { useState } from "react";
import { callApi, isFailure, type AdminStoreDetailDto } from "../../lib/client/api";
import { PASSWORD_MAX } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { ConfirmBox } from "./ConfirmBox";
import { useAdminAction } from "./useAdminAction";
import styles from "./admin.module.css";

const FIELD_NAMES = ["currentPassword"];
/** 今のパスワードが合わない断りは、欄の直下に語の文で出す（理由の雛形では中身が言えない）。 */
const MISMATCH_KINDS = ["password_mismatch"];
/** 運営の今のパスワードの欄の id（断りの文がこの欄を指す・横断-05） */
const CURRENT_PASSWORD_ID = "temp-password-current";

export const TempPasswordPanel = ({ store }: { store: AdminStoreDetailDto }) => {
  const [confirming, setConfirming] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  /** 発行した仮のパスワード。入口が見せるただ1回（基準 14.13）なので、この画面を離れると消える。 */
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const issue = useAdminAction();

  const send = async () => {
    const result = await issue.run(() => callApi("POST /api/admin/stores/:id/temp-password", { params: { id: store.id }, body: { currentPassword } }));
    if (result === null || isFailure(result)) return;
    setConfirming(false);
    setCurrentPassword("");
    setTempPassword(result.tempPassword);
  };

  const cancel = () => {
    setConfirming(false);
    setCurrentPassword("");
    issue.clear();
  };

  return (
    <section data-testid="form-temp-password" className={styles.actionBlock} aria-labelledby="store-temp-password-title">
      <h2 id="store-temp-password-title">パスワードを忘れた店への対応</h2>
      {tempPassword === null ? (
        <>
          <p className={styles.actionLead}>仮のパスワードを発行して、あなたのメールで店へ伝えます。</p>
          <div className={styles.btnRow}>
            <button type="button" data-testid="btn-temp-password" onClick={() => setConfirming(true)}>
              仮のパスワードを発行する
            </button>
          </div>
          {confirming && (
            <ConfirmBox
              testId="confirm-temp-password"
              label="仮のパスワードを発行する前の確かめ"
              text="今のパスワードは使えなくなり、この店の開いている画面はすべてログアウトされます。仮のパスワードはここに1回だけ表示され、あなたのメールで店へ伝えます。確かめのため、あなた（運営）の今のパスワードを入れてください。"
              confirmTestId="btn-confirm-temp-password"
              confirmLabel="発行する"
              busy={issue.busy}
              ready={currentPassword !== ""}
              onConfirm={() => void send()}
              onCancel={cancel}
            >
              <label className={styles.reasonField}>
                <span>あなた（運営）の今のパスワード</span>
                <input
                  id={CURRENT_PASSWORD_ID}
                  type="password"
                  data-testid="field-currentPassword"
                  autoComplete="current-password"
                  maxLength={PASSWORD_MAX}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  {...fieldAria("currentPassword", issue.failure, CURRENT_PASSWORD_ID, { kinds: MISMATCH_KINDS })}
                />
              </label>
              <FieldMessage name="currentPassword" inputId={CURRENT_PASSWORD_ID} failure={issue.failure} kinds={MISMATCH_KINDS} />
              <FormMessage failure={issue.failure} fieldNames={FIELD_NAMES} />
            </ConfirmBox>
          )}
        </>
      ) : (
        <div data-testid="temp-password-issued" className={styles.secret}>
          <p className={styles.secretLabel}>仮のパスワード</p>
          <code data-testid="temp-password" className={styles.secretCode}>
            {tempPassword}
          </code>
          <p className={styles.secretHint}>
            この値はここにしか表示されません。{store.email ? <a href={`mailto:${store.email}`}>{store.email}</a> : "店"} へあなたのメールで伝えてください。店は次のログインで新しいパスワードを決めます。
          </p>
        </div>
      )}
    </section>
  );
};
