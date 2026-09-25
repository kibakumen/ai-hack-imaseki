"use client";

// こだわり条件のいちばん下の電話番号（任意）。`FetchForm` から切り出した（2026-09-25）。
// 本人の指摘（2026-09-22）「客の最初の登録画面はいりません。こだわり条件の下に任意で電話番号を登録できるように」。
//
// 自動の登録は仮の番号（`GUEST_PHONE_PLACEHOLDER`）で済ませてあるので、仮のままなら欄は空で見せ、
// 入れられたら登録の変更の入口（`PATCH /api/customer/profile`）で本物に差し替える。空のままで
// 「今すぐ探す」が押せる（必須にしない）。

import { useRef, useState } from "react";
import { callApi, isFailure, type ApiFailure } from "../../lib/client/api";
import { phoneOrPlaceholder } from "../../lib/client/guestIdentity";
import { PERSONAL_DATA_TEXTS } from "../../lib/domain/texts";
import { GUEST_PHONE_PLACEHOLDER, PHONE_MAX_LENGTH } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

const PHONE_HINT = "数字10桁か11桁";

/**
 * 登録されている電話番号を、欄に見せる形へ直す。仮の番号（自動の登録が入れたもの）は**空**で見せる
 * ——客に「0000000000」を見せると自分の番号だと誤読するため。
 * 「仮かどうか」の正本は `domain/guest` の `isPlaceholderPhone`（店の一覧が使う）。部品はそれを値として
 * 読めない（依存の向き）ので `schemas/limits` の写しの定数で比べ、答えが正本と同じことは
 * `tests/domain/guest.test.ts` が場合を並べて固定する。
 */
export const phoneToShow = (stored: string | undefined | null): string => (typeof stored !== "string" || stored === GUEST_PHONE_PLACEHOLDER ? "" : stored);

/** 欄の値を、登録へ送る形へ直す。空欄は仮の番号へ戻す（＝番号を消したことになる）。 */
export const phoneToStore = phoneOrPlaceholder;

/** 登録の値（電話番号の変更は登録の変更の入口へ4項目まとめて送るので、残りの3つも読む）。 */
export type ProfileForPhone = { nickname?: string; phone?: string; genres?: string[]; budgetMax?: number | null };

/**
 * 電話番号の欄の状態と、登録へ保存する操作（欄を離れたとき・「今すぐ探す」を押したとき）。
 * 登録されている値と送っている最中の値は ref——欄を離れた直後に「今すぐ探す」を押されても、
 * 同じ値を2度送らないため（state だと更新が描き直しまで届かない）。
 */
export const useOptionalPhone = (profile?: ProfileForPhone) => {
  const [phone, setPhone] = useState(phoneToShow(profile?.phone));
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const storedRef = useRef<string | null>(typeof profile?.phone === "string" ? profile.phone : null);
  const savingRef = useRef<string | null>(null);

  /**
   * 登録されている値と同じなら送らない。登録の変更の入口は4項目まとめて受けるので、呼び名・ジャンル・予算は
   * **登録の値**（この回の好みではない）をそのまま添える。呼び名が読めない応答では保存できないので何もしない。
   */
  const persist = async (): Promise<void> => {
    const nickname = profile?.nickname;
    if (typeof nickname !== "string") return;
    const next = phoneToStore(phone);
    if (next === storedRef.current || next === savingRef.current) return;
    savingRef.current = next;
    const result = await callApi("PATCH /api/customer/profile", { body: { nickname, phone: next, genres: profile?.genres ?? [], budgetMax: profile?.budgetMax ?? null } });
    if (savingRef.current === next) savingRef.current = null;
    if (isFailure(result)) {
      setFailure(result);
      setSaved(false);
      return;
    }
    storedRef.current = next;
    setFailure(null);
    setSaved(next !== GUEST_PHONE_PLACEHOLDER);
  };

  const change = (value: string) => {
    setPhone(value);
    setSaved(false);
  };

  return { phone, change, failure, saved, persist };
};

type PhoneFieldProps = ReturnType<typeof useOptionalPhone>;

export const PhoneField = ({ phone, change, failure, saved, persist }: PhoneFieldProps) => (
  <>
    <label htmlFor="fetch-phone">電話番号（任意）</label>
    {/* どの店にいつまで見えるかも書く（2026-09-25 監査の指摘 安全-17 の案3） */}
    <p className="fetch-phone-note">{PERSONAL_DATA_TEXTS.fetchPhoneNote}</p>
    <input
      id="fetch-phone"
      data-testid="field-phone"
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      placeholder="09012345678"
      value={phone}
      maxLength={PHONE_MAX_LENGTH}
      onChange={(event) => change(event.target.value)}
      onBlur={() => void persist()}
    />
    <FieldMessage name="phone" failure={failure} ctx={{ field: "電話番号", hint: PHONE_HINT }} />
    <FormMessage failure={failure} fieldNames={["phone"]} />
    {saved ? (
      <p className="fetch-phone-status" data-testid="phone-saved">
        電話番号を登録しました。
      </p>
    ) : null}
  </>
);
