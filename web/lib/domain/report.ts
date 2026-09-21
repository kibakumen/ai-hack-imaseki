// 通報と「最近行った店」の期間の判断（要件26）。副作用なし・時計は引数で受け取る
// （設計書「どの判断をどこに置くか」）。
//
// 7日は**2つのことを同時に決める**（要件26の補足・本人選択 `04_v2の注文.md` の16節）:
//   ①「最近行った店」に行を出す期間（基準 26.10・26.15）
//   ②その店への通報を受け付ける期間（基準 26.18）
// 2つが同じ長さなので、一覧に出ている店の通報ボタンは必ず通り、一覧から消えた店へ API へ直に
// 送られた通報は通らない。**片方だけ変えると、押せるのに断られるボタンが生まれる**ので、
// 値はこの1か所だけに置く。

/** 完了済みにしてから何日ぶんを「最近行った店」として扱うか（7日・値は AI判断）。 */
export const RECENT_STORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 完了済みにした時刻が、今から見て7日の内か（ちょうど7日は、もう外）。
 * 期限切れの猶予（`reservation.isWithinExpiredGrace`）と同じ向きで境界を切る。
 */
export const isWithinRecentWindow = (completedAt: Date, now: Date): boolean =>
  now.getTime() - completedAt.getTime() < RECENT_STORE_WINDOW_MS;

/** 一覧と通報の判定が SQL の側で要る「この時刻より後だけ」の境目。 */
export const recentWindowStart = (now: Date): Date => new Date(now.getTime() - RECENT_STORE_WINDOW_MS);
