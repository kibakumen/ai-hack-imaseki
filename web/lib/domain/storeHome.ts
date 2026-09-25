import { isGuestNickname, isPlaceholderPhone } from "./guest";
import { canCancelByStore, canComplete, effectiveState, isWithinExpiredGrace } from "./reservation";
import { formatTimeOfDay, latestUntilOf } from "./until";
// 店のホームに何を出すかの判断（設計書「どの判断をどこに置くか」）。副作用なし・時計も引数で受け取る。
//
// ⚠️ 2026-09-21 の並列の実装では、ここに在るのはタスク7の分（足りない店の情報）だけ。
//    **タスク9が `publishPrefill({ lastOffer, coupons, now })`**（公開のフォームの初めの値）を、
//    **タスク17が「向かっている客」の行の作り方**を、この同じファイルへ足す（タスク表の契約の行）。

/** 店のホームと運営の詳細が出す、承認の状況の3種（表の `stores.status` と同じ語）。 */
export type StoreStatusView = "pending" | "approved" | "banned";

/** 公開中のオファーのカードの中身（受け入れ検査の契約 `OfferDto`）。中身を埋めるのはタスク9。 */
export type OfferView = {
  id: string;
  capacity: number;
  remaining: number;
  partyMax: number;
  untilAt: string;
  publishedAt: string;
  coupons: Array<{ id: string; name: string; note: string }>;
  /** 公開から12時間の時刻（ISO）。「何時まで」の上限として画面が使う */
  latestUntil: string;
  /** 店が「何時まで」（終了タイマー）を入れたか。false なら untilAt は公開から12時間の自動の終わり（店-05） */
  untilSet: boolean;
};

/** 「向かっている客」の1行（受け入れ検査の契約 `ArrivalRow`）。中身を埋めるのはタスク17。 */
export type ArrivalView = {
  reservationId: string;
  kind: "active" | "expired" | "completed" | "store_cancelled";
  /**
   * 客の呼び名。客が自分で決めていない（自動の登録の `guest-…`・消した客の空）なら null——店の画面は
   * 「お客さま」と出し、見分けはコードに任せる（横断-02 の案A。客は自分の仮の呼び名を知らない）。
   */
  nickname: string | null;
  /**
   * 受け取った時点の電話番号。登録が無い（自動の登録の仮の番号・空）なら null——店の画面は発信の
   * リンクを付けず「電話番号の登録なし（コードで照合）」と出す（横断-02 の案A。仮の番号へ発信させない）。
   */
  phone: string | null;
  party: number;
  code: string;
  expiresAt: string;
  canComplete: boolean;
  canCancel: boolean;
};

/** 公開のフォームの初めの値。中身を埋めるのはタスク9（`publishPrefill`）。 */
export type PublishPrefillView = { couponIds: string[]; capacity: number | null; partyMax: number | null; until: string | null };

/** オファーを公開するために埋まっていなければならない、店の情報の項目（設計書 17.11 の行）。 */
export const REQUIRED_PROFILE_FIELDS = ["name", "address", "genres", "budget"] as const;
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export type ProfileForPublish = {
  name: string | null;
  address: string | null;
  genres: string[];
  budgetMin: number | null;
  budgetMax: number | null;
};

const isBlank = (value: string | null): boolean => value === null || value.trim() === "";

/**
 * 公開に足りていない店の情報の項目を、決まった順で返す（要件12の基準 12.8・要件17の基準 17.11）。
 *
 * ⚠️ 店のホームの `missingProfile` と、公開を断るときの `profile_incomplete` の `fields` は、
 * **同じここを通す**（1つの責務は1か所）。片方だけを直すと、画面の案内と断りの理由がずれる。
 * （2026-09-25 監査の指摘 設計-10: 予算を `budgetMin`・`budgetMax` で返す2本目の判定が公開の断りで使われて
 * いたので消した。予算の幅は1項目 `budget` として返す。）
 */
export const missingProfileFields = (profile: ProfileForPublish): RequiredProfileField[] => {
  const missing: RequiredProfileField[] = [];
  if (isBlank(profile.name)) missing.push("name");
  if (isBlank(profile.address)) missing.push("address");
  if (profile.genres.length === 0) missing.push("genres");
  if (profile.budgetMin === null || profile.budgetMax === null) missing.push("budget");
  return missing;
};

// ---------- タスク9（公開のフォームの初めの値・公開の断りの項目） ----------

// 店のホームに何を出すかの判断（設計書「どの判断をどこに置くか」）。
// ⚠️ このファイルはタスク9（公開のフォームの初めの値・店の情報の足りないもの）と、
// タスク17・20（向かっている客の行）が分けて持つ。関数ごとに要件を書く。


// ---------- 公開のフォームの初めの値（要件17の基準 17.17〜17.21） ----------

export type PublishPrefill = {
  couponIds: string[];
  capacity: number | null;
  partyMax: number | null;
  /** "HH:MM"。前回の値が今の枠に無ければ null（基準 17.19） */
  until: string | null;
};

export type LastOffer = {
  /** 公開したときに入れた組数（基準 17.17。「追加で出す」で積み上がった合計は使わない） */
  initialCapacity: number;
  /** 終わった時点の募集する組数。初めの値には使わないが、読む側の取り違えを防ぐために形に残す */
  capacity: number;
  /** 終わった時点の「何名まで」（基準 17.17） */
  partyMax: number;
  untilAt: Date;
  /**
   * 店が「何時まで」（終了タイマー）を入れたか。false（入れずに公開して、公開から12時間で自動で終わった）なら、
   * 次の公開の初めの値に「何時まで」を入れない（店-05）。無ければ入れたものとみなす（それまでは必須だった）。
   */
  untilSet?: boolean;
  couponIds: string[];
};

/**
 * 前回の「何時まで」を、**日付ごとそのまま**今と比べて、今を起点にした枠（今より後で、今から12時間以内）に
 * 入るときだけ "HH:MM" にする（基準 17.18・17.19）。
 *
 * ⚠️ 2026-09-25 監査の指摘 不具合-09: それまでは日付を捨てて時分だけを今から解き直していたので、先週金曜の
 *    「18:00まで」でも、今が 06:00〜18:00 の間なら今日の 18:00 として入り、畳まれた欄のまま公開されていた。
 */
const prefillUntil = (untilAt: Date, now: Date): string | null =>
  untilAt.getTime() > now.getTime() && untilAt.getTime() <= latestUntilOf(now).getTime() ? formatTimeOfDay(untilAt) : null;

/**
 * 前回のオファーから、公開のフォームの初めの値を決める。
 * 前回が無ければどの欄も空（基準 17.21）。削除されたクーポンはチェックから外れる（基準 17.20）。
 * 「何時まで」は、前回の時刻が今を起点にした枠（今より後で12時間以内）に在るときだけ入れる（基準 17.18・17.19）。
 * 前回が「何時まで」を入れずに公開した（自動の終わり）なら入れない（店-05）。
 */
export const publishPrefill = ({
  lastOffer,
  coupons,
  now,
}: {
  lastOffer: LastOffer | null;
  coupons: ReadonlyArray<{ id: string }>;
  now: Date;
}): PublishPrefill => {
  if (!lastOffer) return { couponIds: [], capacity: null, partyMax: null, until: null };

  const alive = new Set(coupons.map((coupon) => coupon.id));

  return {
    couponIds: lastOffer.couponIds.filter((id) => alive.has(id)),
    capacity: lastOffer.initialCapacity,
    partyMax: lastOffer.partyMax,
    until: lastOffer.untilSet === false ? null : prefillUntil(lastOffer.untilAt, now),
  };
};

// ---------- 「向かっている客」の一覧の行（タスク17・要件20の基準 20.1〜20.5・20.14〜20.16） ----------

/** 完了済みの行を一覧に残す長さ（24時間・基準 20.14・値は AI判断）。 */
export const COMPLETED_ROW_VIEW_MS = 24 * 60 * 60 * 1000;

/** 店が取り消した行を、電話番号とともに残す長さ（20分・基準 20.16・本人選択）。 */
export const STORE_CANCELLED_ROW_VIEW_MS = 20 * 60 * 1000;

/**
 * 一覧に出しうる行のいちばん長い残り方。読む側（`repo/reservations` の問い合わせ）が
 * 「いつ以降の行を読めば足りるか」をこれで決める——上の3つの長さのうち最も長いもの。
 * 確保中・期限切れの行は受け取りから40分で消えるので、24時間で全部を覆える。
 */
export const ARRIVALS_WINDOW_MS = COMPLETED_ROW_VIEW_MS;

/** 一覧の行を決めるのに要る、確保1行ぶん（表の列と同じ名前。時刻は Date で受け取る）。 */
export type ArrivalRowInput = {
  reservationId: string;
  status: string;
  expiresAt: Date;
  /** 状態が最後に変わった時刻（確保中・期限切れでは受け取った時刻） */
  statusAt: Date;
  nickname: string;
  phone: string;
  party: number;
  code: string;
  /** その客が、この確保より後に別の確保を作ったか（基準 20.12） */
  hasNewerReservation: boolean;
};

/**
 * その行を一覧に出すか、出すならどの見え方か。出さないなら null。
 *   確保中               → いつでも出す（基準 20.1）
 *   期限切れ             → 期限から20分以内で、客が新しい確保を作っていないときだけ（基準 20.5・20.12）
 *   完了済み             → 完了済みにしてから24時間（基準 20.14）
 *   店が取り消した       → 取り消しから20分（基準 20.16）
 *   客が取り消した・運営に取り消された → 出さない（基準 20.15）
 */
const visibleKind = (row: ArrivalRowInput, now: Date): ArrivalView["kind"] | null => {
  const state = effectiveState(row, now);
  const sinceChange = now.getTime() - row.statusAt.getTime();
  if (state === "active") return "active";
  if (state === "expired") return isWithinExpiredGrace(row, now) && !row.hasNewerReservation ? "expired" : null;
  if (state === "completed") return sinceChange < COMPLETED_ROW_VIEW_MS ? "completed" : null;
  if (state === "store_cancelled") return sinceChange < STORE_CANCELLED_ROW_VIEW_MS ? "store_cancelled" : null;
  return null;
};

/**
 * 一覧の行を、期限の近い順（基準 20.2）に並べて返す。人数は確保の今の値なので、客が変えれば
 * そのまま映る（基準 20.3）。できる操作は2つの判断に委ねる——完了済みは `canComplete`
 * （`domain/reservation`・入口の断りと同じ関数）、取り消しは確保中の行だけ（要件21の基準 21.1）。
 */
export const arrivalRows = (rows: readonly ArrivalRowInput[], now: Date, options: { storeBanned: boolean }): ArrivalView[] =>
  rows
    .flatMap((row) => {
      const kind = visibleKind(row, now);
      return kind === null ? [] : [{ row, kind }];
    })
    .sort((a, b) => a.row.expiresAt.getTime() - b.row.expiresAt.getTime())
    .map(({ row, kind }) => ({
      reservationId: row.reservationId,
      kind,
      // 自動の登録の仮の値は、店へ渡す手前で外す（横断-02 の案A。見分けは `domain/guest` の1か所）
      nickname: isGuestNickname(row.nickname) ? null : row.nickname,
      phone: isPlaceholderPhone(row.phone) ? null : row.phone,
      party: row.party,
      code: row.code,
      expiresAt: row.expiresAt.toISOString(),
      canComplete: canComplete({ ...row, storeBanned: options.storeBanned }, now),
      // 入口の断り（usecases/cancelByStore）と同じ規則を、画面のボタンも読む。
      // 止められている店に操作を出さないのは、完了済み（基準 20.23）と同じ扱い。
      canCancel: canCancelByStore(row, now) && !options.storeBanned,
    }));
