"use client";

// 押す前の確かめ（止める・戻す・仮のパスワード）。何が起きるかを先に見せて、確かめてから入口を呼ぶ。
//
// 2026-09-25 監査の指摘 運営-01: 取り消しと戻すは**理由を入れるまで押せない**（`reason` を渡すと欄が出る）。
// 運営-04: 送っている間は押せない（`busy`。ボタンは全画面で共通の components/ui/Submit・横断-03）。断りは呼ぶ側が `children` に入れて、この箱の中に出す（運営-13）。

import type { ReactNode } from "react";
import { ADMIN_REASON_MAX } from "../../lib/schemas/limits";
import { SubmitButton } from "../ui/Submit";
import styles from "./admin.module.css";

type ReasonField = { value: string; onChange: (value: string) => void; label: string };

type ConfirmProps = {
  testId: string;
  label: string;
  text: string;
  confirmTestId?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** 渡すと理由の欄を出し、空白だけのあいだは押せない */
  reason?: ReasonField;
  /** 確かめの前に入れさせる欄（仮のパスワードの発行の今のパスワードなど）。`ready` が false のあいだは押せない */
  ready?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export const ConfirmBox = ({ testId, label, text, confirmTestId = "btn-confirm", confirmLabel, danger = false, busy = false, reason, ready = true, onConfirm, onCancel, children }: ConfirmProps) => {
  const reasonMissing = reason !== undefined && reason.value.trim() === "";
  return (
    <div data-testid={testId} role="group" aria-label={label} className={styles.confirmBox}>
      <p className={styles.confirmText}>{text}</p>
      {reason && (
        <label className={styles.reasonField}>
          <span>{reason.label}</span>
          <textarea data-testid="field-reason" rows={2} maxLength={ADMIN_REASON_MAX} value={reason.value} onChange={(event) => reason.onChange(event.target.value)} />
        </label>
      )}
      {children}
      <div className={styles.btnRow}>
        <SubmitButton type="button" data-testid={confirmTestId} className={danger ? styles.dangerBtn : undefined} busy={busy} disabled={reasonMissing || !ready} onClick={onConfirm}>
          {confirmLabel}
        </SubmitButton>
        <button type="button" className={styles.quietBtn} onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
};
