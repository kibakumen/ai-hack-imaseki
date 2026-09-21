// 起点と店の間の距離・徒歩の分数・日本の範囲の判定（要件5の基準 5.1／要件4の基準 4.9／要件3の基準 3.6）。
// 副作用なし・自分だけを読む（設計書「依存の向き」）。時計も乱数も使わない。

export type Point = { lat: number; lng: number };

/** 探す範囲は直線800m で固定（基準 5.1・客は変えられない・本人選択） */
export const SEARCH_RADIUS_METERS = 800;
/** 徒歩の分速（基準 4.9・値は AI判断） */
export const WALK_METERS_PER_MINUTE = 80;
/** 日本の範囲（基準 3.6・範囲は AI判断）。境界の値は範囲の内に含む */
export const JAPAN_BOUNDS = { latMin: 20, latMax: 46, lngMin: 122, lngMax: 154 } as const;

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * 2点の直線距離（メートル・haversine の式）。
 *
 * 丸めない——受け入れ検査が検査の側の式と 0.5m 以内で一致することを見る（r05 の基準 5.1）ので、
 * 整数へ丸めると誤差がその幅に届きうる。呼ぶ側が見せる分数は walkMinutes が切り上げる。
 */
export const distanceMeters = (a: Point, b: Point): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
};

/** 起点が探す範囲（800m）の内か（基準 5.1）。境界のちょうど800m は内 */
export const withinSearchRadius = (origin: Point, target: Point): boolean => distanceMeters(origin, target) <= SEARCH_RADIUS_METERS;

/** 直線距離を分速80m で割って切り上げた分数（基準 4.9）。0m はそのまま0分 */
export const walkMinutes = (meters: number): number => Math.ceil(Math.max(0, meters) / WALK_METERS_PER_MINUTE);

/** 位置が日本の範囲（北緯20〜46度・東経122〜154度）の内か（基準 3.6） */
export const inJapan = (point: Point): boolean =>
  point.lat >= JAPAN_BOUNDS.latMin &&
  point.lat <= JAPAN_BOUNDS.latMax &&
  point.lng >= JAPAN_BOUNDS.lngMin &&
  point.lng <= JAPAN_BOUNDS.lngMax;
