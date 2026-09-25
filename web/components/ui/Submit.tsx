"use client";

// 送る操作のボタンと、済んだ知らせの1行（2026-09-25 監査の指摘 横断-03）。状態は components/ui/useSubmit が持つ。
//   SubmitButton … 送っている間は押せず、文言を「送っています…」（または渡した文）に替える。aria-busy も立てる
//   DoneNotice   … 済んだことを role=status の1行で伝える（読み上げにも届く）
// 色は持たない（app/controls.css の `.done-notice`・`.visually-hidden`）。

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { SUBMIT_TEXTS } from "../../lib/domain/texts";

type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 送っている間 true（useSubmit の busy） */
  busy: boolean;
  /** 送っている間の文言（既定は「送っています…」） */
  busyLabel?: string;
  children: ReactNode;
};

export const SubmitButton = ({ busy, busyLabel = SUBMIT_TEXTS.sending, disabled = false, children, ...rest }: SubmitButtonProps) => (
  <button {...rest} disabled={busy || disabled} aria-busy={busy || undefined}>
    {busy ? busyLabel : children}
  </button>
);

type DoneNoticeProps = { message: string | null; testId?: string };

/**
 * 済んだことの1行。知らせが無い間も、空の role=status の入れ物を隠して描いておき、知らせが来たら中身だけを入れる
 * （横断-03 のレビュー）。読み上げの領域は、中身が変わる前から DOM に在らないと告げない組み合わせが多い
 * ——それまでは知らせが来た瞬間に入れ物ごと差し込んでいた（客の画面の live-status と同じ形にそろえた）。
 * `testId` は知らせが出ている間だけ付ける（検査の「知らせが出た」を、空の入れ物で満たさないため）。
 */
export const DoneNotice = ({ message, testId = "done-notice" }: DoneNoticeProps) => (
  <p className={message === null ? "visually-hidden" : "done-notice"} role="status" data-testid={message === null ? undefined : testId}>
    {message ?? ""}
  </p>
);
