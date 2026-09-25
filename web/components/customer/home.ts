// 客の画面が読む応答の形（`GET /api/customer/home` と、受け取り・受け取り直しの応答に載る `home`）。
//
// 型はサーバーと同じ定義（schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
// `client/api` の `callApi` が応答をこの形で確かめてから返す。

import type { CustomerHomeDto, ReservationViewDto } from "../../lib/client/api";

/** 確保1件（応答 `ReservationDto`）。時刻は ISO 8601 の文字列。 */
export type ReservationDto = ReservationViewDto;

/** 期限切れの表示の中身（要件11の基準 11.6〜11.9。判断はサーバー側の `domain/customerHome`）。 */
export type ExpiredDto = NonNullable<CustomerHomeDto["expired"]>;

/**
 * 客の画面が開いた時にまず出すもの（設計書「客の画面」の優先の順）。`reservation` と `expired` は場面によって無い。
 * 端末に残した古いホーム（client/reservationCache）は形を確かめずに読むので、`profile` と `reservation.origin` は
 * 無いことがある前提で読む。
 */
export type HomeDto = CustomerHomeDto;

/**
 * 受け取り・受け取り直しが断られた理由と次の一手（409 の `refusal`）。
 * どちらも手続き（`usecases/receiveOffer`）が決めたものを、画面はそのまま描く。
 * 描くのは `RefusalNotice` ただ1つ（設計書「受け取りが断られたとき」の5）。
 */
export type ReceiveRefusal = { kind: string; nextStep: string; partyMax?: number };
