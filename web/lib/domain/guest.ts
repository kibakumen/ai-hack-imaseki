// 自動の登録（`components/customer/GuestEntry`）が入れる仮の値と、その見分けのただ1つの置き場
// （2026-09-25 監査の指摘 横断-02 とそのレビュー）。自分だけを読む（依存の向き）。
//
// 部品は lib/domain のうち texts.ts しか値として読めないので、部品が要る2つの定数（仮の番号・呼び名の頭）は
// schemas/limits.ts に写しを置く。写しが黙ってずれないことは tests/domain/guest.test.ts が固定する
// （domain/genres.ts と texts.ts の関係と同じ形）。

/**
 * 仮の電話番号（2026-09-22）。客に聞かずに登録を済ませるための、形（`PHONE_PATTERN`）だけを満たす
 * 実在しない番号。取得の画面の電話番号の欄は、登録がこの値のままなら空で見せ、入れられたら本物に差し替える。
 */
export const GUEST_PHONE_PLACEHOLDER = "0000000000";

/** 自動の登録が作る呼び名の頭（`guest-` ＋ 6字）。客は自分のこの呼び名を知らない。 */
export const GUEST_NICKNAME_PREFIX = "guest-";

/**
 * 電話番号が「無い」か（空・自動の登録の仮の番号）。店の一覧（`domain/storeHome`）はこれで仮の番号を外し、
 * 発信のリンクを付けない（横断-02 の案A）。
 */
export const isPlaceholderPhone = (phone: string | null | undefined): boolean => !phone || phone === GUEST_PHONE_PLACEHOLDER;

/** 呼び名が「客が決めたものでない」か（空・自動の登録の `guest-…`）。店の一覧は「お客さま」と出す（横断-02）。 */
export const isGuestNickname = (nickname: string | null | undefined): boolean => !nickname || nickname.startsWith(GUEST_NICKNAME_PREFIX);
