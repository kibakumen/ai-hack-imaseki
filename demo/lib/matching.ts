// 席アキのジオマッチングと段階配信。LLM を使わない決定論の処理（同じ入力なら毎回同じ結果）。
// 数千人を数百 ms 以内に評価できるよう、ここには外部呼び出しを置かない。

export type LatLng = { lat: number; lng: number };

export type Prefs = { genres: string[]; budgetMax: number | null; allergies: string[] };

export type StoreForMatch = { genre: string; avgPrice: number; allergens: string[]; location: LatLng };

export type CustomerForMatch = { id: string; location: LatLng; prefs: Prefs };

export type Wave = { index: number; size: number; sentAt: number };

export const CONFIG = {
  walkMetersPerMinute: 80,
  maxWalkMinutes: 10, // 徒歩圏 = 80 m/分 × 10分 = 800 m
  firstWaveSize: 10,
  waveMultiplier: 2,
  capPerSeat: 4, // 配信総数の上限 = 空席数 × 4
  // たたき台は180秒。デモでは波が広がる様子を見せるため短くする（環境変数で変えられる）
  waveWaitMs: Number(process.env.WAVE_WAIT_SECONDS ?? 20) * 1000,
  offerTtlMs: 30 * 60 * 1000,
} as const;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export const distanceMeters = (a: LatLng, b: LatLng): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
};

export type Candidate = { id: string; distanceM: number };

/** 候補抽出 → ハード除外 → 並べ替え。嗜好が空の項目では絞らない */
export const rankCandidates = (store: StoreForMatch, customers: CustomerForMatch[]): Candidate[] => {
  const radius = CONFIG.walkMetersPerMinute * CONFIG.maxWalkMinutes;
  return customers
    .map((c) => ({ c, distanceM: Math.round(distanceMeters(store.location, c.location)) }))
    .filter(({ distanceM }) => distanceM <= radius)
    .filter(({ c }) => !c.prefs.allergies.some((a) => store.allergens.includes(a)))
    .filter(({ c }) => c.prefs.budgetMax === null || store.avgPrice <= c.prefs.budgetMax)
    .filter(({ c }) => c.prefs.genres.length === 0 || c.prefs.genres.includes(store.genre))
    .sort((x, y) => x.distanceM - y.distanceM || x.c.id.localeCompare(y.c.id))
    .map(({ c, distanceM }) => ({ id: c.id, distanceM }));
};

export const capFor = (seats: number) => seats * CONFIG.capPerSeat;

/** 各波（第1波を含む）の人数 = 予定人数・未配信の候補数・上限までの残りの最小値 */
export const waveSize = (waveIndex: number, remainingCandidates: number, remainingCap: number) =>
  Math.max(0, Math.min(CONFIG.firstWaveSize * CONFIG.waveMultiplier ** (waveIndex - 1), remainingCandidates, remainingCap));

export type OfferState = {
  status: "active" | "stopped" | "capped" | "exhausted" | "expired";
  seats: number;
  cap: number;
  expiresAt: number;
  candidateCount: number;
  waves: Wave[];
  lastCheckAt: number;
};

export type Decision =
  | { kind: "none" }
  | { kind: "close"; status: "capped" | "exhausted" | "expired"; reason: string }
  | { kind: "send"; wave: Wave; checkAt: number }
  | { kind: "hold"; checkAt: number; reason: string };

/**
 * 今この時点で何をするかを1つ決める（副作用なし）。
 * reactionsSinceCheck = 前回の判定以降に「行きます」が押された数、goingTotal = 「行きます」の累計
 */
export const decide = (o: OfferState, now: number, sentTotal: number, reactionsSinceCheck: number, goingTotal: number): Decision => {
  if (o.status !== "active") return { kind: "none" };
  if (now >= o.expiresAt) return { kind: "close", status: "expired", reason: "有効期限（30分）が過ぎた" };
  const remainingCap = o.cap - sentTotal;
  const remainingCandidates = o.candidateCount - sentTotal;
  if (o.waves.length === 0) {
    if (remainingCandidates <= 0) return { kind: "close", status: "exhausted", reason: "条件に合う客が近くにいなかった" };
    const size = waveSize(1, remainingCandidates, remainingCap);
    return { kind: "send", wave: { index: 1, size, sentAt: now }, checkAt: now };
  }
  if (remainingCap <= 0) return { kind: "close", status: "capped", reason: `配信総数の上限（空席数×${CONFIG.capPerSeat}＝${o.cap}人）に達した` };
  if (remainingCandidates <= 0) return { kind: "close", status: "exhausted", reason: "条件に合う客に配り終えた" };
  if (now - o.lastCheckAt < CONFIG.waveWaitMs) return { kind: "none" };
  const checkAt = o.lastCheckAt + CONFIG.waveWaitMs;
  if (goingTotal >= o.seats) return { kind: "hold", checkAt, reason: "「行きます」が空席数に届いたので広げない" };
  if (reactionsSinceCheck > 0) return { kind: "hold", checkAt, reason: "待ち時間の間に「行きます」があったので広げない" };
  const index = o.waves.length + 1;
  return { kind: "send", wave: { index, size: waveSize(index, remainingCandidates, remainingCap), sentAt: checkAt }, checkAt };
};
