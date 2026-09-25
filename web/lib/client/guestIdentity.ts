// 客に聞かずに登録を済ませるための仮の値（2026-09-22 の本人の指摘「名前とかも電話番号と照合コードが
// あるからいらない気がする。顧客自体の識別が必要なら適当な文字列でも生成しといて」「電話番号も入力不要でいい」）。
// 裏の自動の登録（GuestEntry）と、それが通らなかったときの受け皿の登録の入力（RegisterForm）の両方が使う
// （2026-09-25 監査の指摘 客-02: 受け皿の側も呼び名を自動で作り、電話番号を任意にする）。

import { GUEST_PHONE_PLACEHOLDER } from "../schemas/limits";

/** 自動で作る呼び名。`guest-` ＋ 6字（呼び名の上限20字に収まる）。店は照合コードで客を見分けるので本名は要らない。 */
export const guestNickname = (): string => `guest-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 電話番号の欄の値を、登録へ送る形へ直す。空欄は仮の番号（形の正本は `schemas/limits.ts` の `PHONE_PATTERN`）
 * ——実在しない番号を入れるのは、客に聞かずに登録を済ませるため。仮の番号は画面では空として見せる。
 */
export const phoneOrPlaceholder = (raw: string): string => (raw.trim() === "" ? GUEST_PHONE_PLACEHOLDER : raw.trim());
