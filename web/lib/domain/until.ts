// 「何時まで」の時刻の解釈のただ1つの置き場（設計書「「何時まで」の入力と解釈」・第6周の直し）。
// 入力は時分だけ（例 "02:00"）。**公開した時刻（分の頭に切り下げる）を起点に、その時刻以後で
// 最初にその時分に当たる時点**へ直し、今以前／枠の内（公開から12時間）／枠の外の3つに分ける。
//
// 公開のとき（要件17の基準 17.5・17.6）は起点＝今、公開中の変更（要件19の基準 19.8・19.9・19.13）は
// 起点＝そのオファーを公開した時刻。どちらも同じ関数を通る。
//
// 承知のうえの穴（設計書・AI判断）: 公開した時刻より前の時分（公開 15:00 で "14:00"）は翌日と
// 読まれて枠の外になる。時分だけの入力では見分けられないので、画面が公開した時刻と最長の時刻を
// 欄の横に出して誤読を減らす。

/** 日本時間の時差。場所は日本の中だけ（要件3の基準 3.6）なので定数で固定する（AI判断・設計書）。 */
export const JST_OFFSET_MINUTES = 9 * 60;

/** 公開した時刻から「何時まで」を置ける長さ（12時間・AI判断・設計書「比べた案」）。 */
export const UNTIL_WINDOW_MS = 12 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type UntilKind = "ok" | "in_past" | "over_window";
export type ResolvedUntil = { kind: UntilKind; at: Date; latest: Date };

const floorToMinute = (ms: number): number => ms - (((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);

/** 公開した時刻（分の頭）から数えた、「何時まで」に置ける最長の時点。画面の `latestUntil` もこれ。 */
export const latestUntilOf = (publishedAt: Date): Date => new Date(floorToMinute(publishedAt.getTime()) + UNTIL_WINDOW_MS);

/** "HH:MM" を、その日の始まりからの分に直す。形が違えば null。 */
export const parseTimeOfDay = (input: string): number | null => {
  const matched = TIME_OF_DAY.exec(input);
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) : null;
};

/** ある時点の、日本時間での "HH:MM"。前回のオファーの「何時まで」を欄へ戻すときに使う。 */
export const formatTimeOfDay = (at: Date, offsetMinutes: number = JST_OFFSET_MINUTES): string => {
  const local = at.getTime() + offsetMinutes * MINUTE_MS;
  const minutesOfDay = Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS);
  const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, "0");
  const mm = String(minutesOfDay % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

/**
 * 「何時まで」の時分を時点へ直し、3つに分ける。形が違えば null（入口は `bad_format` に倒す）。
 * 境目: 直した時点が今と同じなら今以前、最長の時点とちょうど同じなら枠の内（要件17の基準 17.5）。
 */
export const resolveUntil = (
  args: { input: string; publishedAt: Date; now: Date },
  offsetMinutes: number = JST_OFFSET_MINUTES,
): ResolvedUntil | null => {
  const minutesOfDay = parseTimeOfDay(args.input);
  if (minutesOfDay === null) return null;

  const origin = floorToMinute(args.publishedAt.getTime());
  const latest = new Date(origin + UNTIL_WINDOW_MS);
  const offsetMs = offsetMinutes * MINUTE_MS;

  // 起点の「その日」（日本時間）の同じ時分を作り、起点より前なら翌日へ送る。
  const localOrigin = origin + offsetMs;
  const localDayStart = localOrigin - (((localOrigin % DAY_MS) + DAY_MS) % DAY_MS);
  const localCandidate = localDayStart + minutesOfDay * MINUTE_MS;
  const localAt = localCandidate < localOrigin ? localCandidate + DAY_MS : localCandidate;
  const at = new Date(localAt - offsetMs);

  if (at.getTime() <= args.now.getTime()) return { kind: "in_past", at, latest };
  if (at.getTime() > latest.getTime()) return { kind: "over_window", at, latest };
  return { kind: "ok", at, latest };
};
