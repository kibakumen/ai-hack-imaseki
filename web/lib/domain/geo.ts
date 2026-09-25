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

/** 緯度経度の四角形（両端を含む）。 */
export type GeoBounds = { latMin: number; latMax: number; lngMin: number; lngMax: number };

/** 四角形を円より少しだけ広げる割合（浮動小数の丸めで、ちょうど800m の店を四角形の外へ落とさないため） */
const BOUNDS_MARGIN = 1.01;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * 起点から探す範囲（800m）の円を**必ず含む**緯度経度の四角形（2026-09-25 監査の指摘 設計-08）。
 *
 * 取得の候補を D1 から読むときの前段の絞りに使う——それまでは全国の受け取れるオファーを読んでから
 * 800m 以内に絞っていた。四角形は円より広いので、ここで残った店のうち範囲の内かを決めるのは、これまで
 * どおり `withinSearchRadius`（基準 5.1・境界のちょうど800m は内）。
 *
 * 経度の幅は、その緯度で円に接する経線までの角度（`asin(sin δ / cos φ)`）。極に近すぎて円が極を含む
 * ときは、経度で絞らない（日本の範囲では起きない）。
 */
export const searchBounds = (origin: Point, meters: number = SEARCH_RADIUS_METERS): GeoBounds => {
  const angular = (meters / EARTH_RADIUS_METERS) * BOUNDS_MARGIN;
  const dLat = toDegrees(angular);
  const ratio = Math.sin(angular) / Math.cos(toRadians(origin.lat));
  const dLng = ratio >= 1 || !Number.isFinite(ratio) ? 180 : toDegrees(Math.asin(ratio));
  return { latMin: origin.lat - dLat, latMax: origin.lat + dLat, lngMin: origin.lng - dLng, lngMax: origin.lng + dLng };
};

/** 直線距離を分速80m で割って切り上げた分数（基準 4.9）。0m はそのまま0分 */
export const walkMinutes = (meters: number): number => Math.ceil(Math.max(0, meters) / WALK_METERS_PER_MINUTE);

/** 位置が日本の範囲（北緯20〜46度・東経122〜154度）の内か（基準 3.6） */
export const inJapan = (point: Point): boolean =>
  point.lat >= JAPAN_BOUNDS.latMin &&
  point.lat <= JAPAN_BOUNDS.latMax &&
  point.lng >= JAPAN_BOUNDS.lngMin &&
  point.lng <= JAPAN_BOUNDS.lngMax;
