"use client";

// 入力の断り（形・範囲の誤りと、項目や操作に帰せる規則の断り）を描くただ1つの部品
// （設計書「入力の誤りの出し方」）。断りの語（error.kind・error.fields）を読むのはこのファイルだけで、
// 自分では判断しない——受け取った語を domain/texts の文にして、項目の直下か操作の直下に出す。
// 文の雛形に入れる数字は、呼ぶ側のフォームが schemas/limits から渡す。
//
// 文の読み手（店と運営か、客か）は `CustomerRefusals` で囲んだかどうかで決まる（2026-09-25 レビューの指摘）。
// 客にはログインが無いので、同じ 401・403 でも「ログイン」を言わない文を出す。囲むのは客の画面の入れ物
// （CustomerApp）の1か所だけで、客の部品が1つずつ読み手を渡すことはしない（渡し忘れた部品が店の文を出すため）。
//
// 欄との結びつき（2026-09-25 監査の指摘 横断-05）: 項目の断りの文は、欄の id から決まる id（`refusalIdOf`）を持ち、
// 欄は `fieldAria` で aria-invalid と aria-describedby を付けてその文を指す。**文を出す条件と欄に印を付ける条件は
// 同じ関数（`fieldRefused`）で決める**——片方だけ直してずれないように。赤枠は CSS の `[aria-invalid="true"]` が付ける
// （それまでは「欄の直後に文がある」という DOM の並びに頼っていて、包まれた欄とダイヤルは赤くならなかった）。

import { createContext, useContext, type ReactNode } from "react";
import type { ApiFailure } from "../../lib/client/api";
import { TEXTS, type RefusalAudience } from "../../lib/domain/texts";

/** 文の雛形に入れる値（項目の名前・上下の数・形の補足など）。 */
export type RefusalContext = Record<string, unknown>;

/** 囲まれていなければ店と運営の文（店と運営の画面は囲まない）。 */
const AudienceContext = createContext<RefusalAudience>("staff");

/** この中の断りの文を、客に向けた文にする（客の画面の入れ物が1か所で囲む）。 */
export const CustomerRefusals = ({ children }: { children: ReactNode }) => <AudienceContext.Provider value="customer">{children}</AudienceContext.Provider>;

/** 断りの種類（kind）の文を、今の読み手に合わせて引く。 */
const useKindText = (): ((kind: string, ctx?: RefusalContext) => string) => {
  const audience = useContext(AudienceContext);
  return (kind, ctx = {}) => TEXTS.inputRefusal(kind, ctx, audience);
};

/** 欄の断りの文の id。欄の id から決める（欄の aria-describedby がこれを指す）。 */
export const refusalIdOf = (inputId: string): string => `${inputId}-refusal`;

/** その項目の断りが返っているか（項目に結びつけた規則の断りの語か、項目の理由）。FieldMessage が文を出す条件と同じ。 */
const fieldRefused = (name: string, failure: ApiFailure | null, kinds: readonly string[]): boolean => {
  const error = failure?.error;
  if (error === undefined) return false;
  if (kinds.includes(error.kind)) return true;
  return (error.fields ?? []).some((f) => f.name === name);
};

/** 欄に付ける属性。`"aria-invalid"` は断りのあるときだけ。 */
export type FieldAria = { "aria-invalid"?: true; "aria-describedby"?: string };

/**
 * 欄に付ける aria-invalid と aria-describedby（横断-05）。断りが返っていれば、同じ `inputId` で描いた
 * FieldMessage の文を指す。`describedBy` は欄がもともと持つ説明（字数の案内など）の id で、断りが無いときも残す。
 * `kinds` は FieldMessage に渡すのと同じ語の一覧（項目に結びつけた規則の断り）。
 */
export const fieldAria = (name: string, failure: ApiFailure | null, inputId: string, options: { kinds?: readonly string[]; describedBy?: string } = {}): FieldAria => {
  const { kinds = [], describedBy } = options;
  if (!fieldRefused(name, failure, kinds)) return describedBy === undefined ? {} : { "aria-describedby": describedBy };
  const ids = [describedBy, refusalIdOf(inputId)].filter((id): id is string => id !== undefined);
  return { "aria-invalid": true, "aria-describedby": ids.join(" ") };
};

type FieldMessageProps = {
  /** 入力のスキーマの項目名（nickname・phone など） */
  name: string;
  /** この文が説明する欄の id（文の id を決める。欄は fieldAria に同じ値を渡す） */
  inputId: string;
  failure: ApiFailure | null;
  ctx?: RefusalContext;
  /**
   * この項目の直下に出す、規則の断りの語（例: 住所が位置に直せなかった address_unresolved）。
   * 理由（reason）だけでは何が起きたか伝わらない断りのために、呼ぶ側が項目に結びつける。
   * 断りの語を読むのはこのファイルだけ（構造の検査が見張る）ので、呼ぶ側は語の一覧を渡すだけにする。
   */
  kinds?: string[];
};

/** その項目の断りが返っているときだけ、入力欄の直下に文を出す。 */
export const FieldMessage = ({ name, inputId, failure, ctx, kinds = [] }: FieldMessageProps) => {
  const kindText = useKindText();
  if (!fieldRefused(name, failure, kinds)) return null;
  const error = failure?.error;
  const kind = error?.kind;
  // 項目に結びついた規則の断りが先。あれば理由の文より、その語の文を出す。
  const field = error?.fields?.find((f) => f.name === name);
  const text = kind !== undefined && kinds.includes(kind) ? kindText(kind, ctx) : TEXTS.fieldReason(field?.reason ?? "", ctx);
  return (
    <p className="msg" role="alert" id={refusalIdOf(inputId)} data-testid={`msg-${name}`}>
      {text}
    </p>
  );
};

/**
 * その項目の断りが返っているとき、**断りの種類（kind）の文**を入力欄の直下に出す
 * （2026-09-21・タスク7 が足した）。
 *
 * ファイルの欄のように、理由の雛形（「◯字で入れてください」）では中身が言えず、種類の文
 * （「PDF・JPEG・PNG のファイルを10MBまでで選んでください」）の方が答えになる場合に使う
 * （設計書「入力の誤りの出し方」の 13.3 の行: ファイルの欄の直下にこの文を出す）。
 * 判断はしない——受け取った語を domain/texts の文にして、項目の直下に出すだけ。
 */
export const FieldKindMessage = ({ name, inputId, failure, ctx }: FieldMessageProps) => {
  const kindText = useKindText();
  const error = failure?.error;
  if (!error?.fields?.some((f) => f.name === name)) return null;
  return (
    <p className="msg" role="alert" id={refusalIdOf(inputId)} data-testid={`msg-${name}`}>
      {kindText(error.kind, ctx)}
    </p>
  );
};

type FormMessageProps = {
  failure: ApiFailure | null;
  /** このフォームが持っている項目名。ここに在る項目の断りは、項目の直下に出るのでここでは出さない。 */
  fieldNames?: string[];
  ctx?: RefusalContext;
  /**
   * 断りの種類ごとに、文の後ろへ足す行き先（例: `profile_incomplete` → 店の情報の画面）。
   * どこへ送るかは画面の話なので呼ぶ側が決め、この部品は語で引いて描くだけ（判断はしない）。
   */
  links?: Record<string, { href: string; label: string }>;
};

/** 項目に帰せない断り（人かどうかの確かめ・規則の断り・通信の失敗）を、押した操作の直下に出す。 */
export const FormMessage = ({ failure, fieldNames = [], ctx, links }: FormMessageProps) => {
  const kindText = useKindText();
  const error = failure?.error;
  if (!error) return null;
  const fields = error.fields ?? [];
  if (fields.some((f) => fieldNames.includes(f.name))) return null;
  const link = links?.[error.kind];
  return (
    <p className="msg" role="alert" data-testid="msg-form">
      {kindText(error.kind, ctx)}
      {link ? <a href={link.href}>{link.label}</a> : null}
    </p>
  );
};

/**
 * 読み込みが断られた・失敗したときの文（2026-09-25 監査の指摘 横断-01）。読み込みの部品
 * （components/ui/LoadState の LoadView）が出す。語の文をそのまま出し、0件の文とは混ぜない。
 * 断りの中身を持たない失敗は、通信の失敗の文に倒す。
 */
export const LoadMessage = ({ failure }: { failure: ApiFailure }) => {
  const kindText = useKindText();
  return (
    <p className="msg" role="alert" data-testid="msg-load">
      {kindText(failure.error?.kind ?? "network")}
    </p>
  );
};
