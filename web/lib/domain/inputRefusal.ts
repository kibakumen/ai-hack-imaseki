// 入力の断りの種類（kind）と、項目ごとの理由（reason）の閉じた語のただ1つの置き場（設計書「入力の断りの応答の形」）。
// lib/domain は自分だけを読む（依存の向き）。この2つの語の一覧を、応答の形（schemas/error.ts）と
// 画面の部品（components/ui/InputRefusal）と domain/texts.ts が共有する。

/** 応答の `error.kind`。手続きが規則で返す語もこの一覧に閉じる（構造の検査が見張る）。 */
export const INPUT_REFUSAL_KINDS = [
  "invalid_input",
  "party_over_max",
  "email_taken",
  "limit_reached",
  "coupon_in_use",
  "address_unresolved",
  "profile_incomplete",
  "offer_exists",
  "offer_ended",
  "until_in_past",
  "until_over_window",
  "approval_missing",
  "file_unsupported",
  "file_too_large",
  "card_setup_failed",
  "login_failed",
  // アカウントの編集（メールアドレスの変更・運営のパスワードの変更）で、確かめのために入れさせた
  // 今のパスワードが保存と合わない（2026-09-22 追加）。ログインの login_failed とは分ける——
  // こちらはもう入っている本人に「今のパスワード」の欄だけを直させる文になる。
  "password_mismatch",
  "place_unresolved",
  "report_not_allowed",
  // 28.5【最終日】登録を消せない（確保中の確保か、期限から20分以内の期限切れの確保がある）。
  // ⚠️ 受け取りの断り（`domain/receiveRefusal.ts`）にも同じ綴りの語が在るが、**別の応答の形**の語
  // ——あちらは `refusal.kind` で描くのは RefusalNotice、こちらは `error.kind` で描くのは
  // InputRefusal。指している出来事が同じなので綴りを揃えた（タスク32 が足した）。
  "has_active_reservation",
  // 20.24・20.25 店が運営に止められている間の、確保への操作の断り（店の画面に出す）。
  // ⚠️ 受け取りの断り（`domain/receiveRefusal.ts`）にも同じ綴りの語が在るが、**別の応答の形**の語
  // ——あちらは客に出す `refusal.kind`、こちらは店に出す `error.kind`。
  "store_banned",
  "human_check_failed",
  "rate_limited",
  // 画面の側だけで作る2つ（client/geolocation・client/api が返す）
  "location_required",
  "network",
] as const;
export type InputRefusalKind = (typeof INPUT_REFUSAL_KINDS)[number];

/** 応答の `error.fields[].reason`。zod の落ちを直すのは http/defineRoute.ts、規則の断りは各 usecases が直接返す。 */
export const FIELD_REASONS = [
  "required",
  "too_short",
  "too_long",
  "out_of_range",
  "not_integer",
  "bad_format",
  "not_allowed",
  "too_many",
  "min_over_max",
  "over_capacity",
  "over_remaining",
  "in_past",
  "over_window",
] as const;
export type FieldReason = (typeof FIELD_REASONS)[number];
