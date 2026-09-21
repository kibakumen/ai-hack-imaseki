// 位置の判断（要件3の基準 3.6・要件15の基準 15.11）。自分だけを読む（依存の向き）。
//
// ⚠️ タスク5（店の情報）は、日本の範囲の判定 inJapan だけをここに置いた。要件15の基準 15.11 が
// 「要件3の基準 3.6 と同じ範囲」と書いており、範囲を2箇所に書くと黙ってずれるため。
// 距離の式 distanceMeters と徒歩の分数 walkMinutes は**タスク10がこのファイルへ足す**
// （設計書「どの判断をどこに置くか」: domain/geo.ts）。

/** 日本の範囲（北緯20〜46度・東経122〜154度。範囲は AI判断・要件3の基準 3.6）。 */
export const JAPAN_BOUNDS = { latMin: 20, latMax: 46, lngMin: 122, lngMax: 154 } as const;

export type LatLng = { lat: number; lng: number };

/** 日本の範囲の中か。境界の値は中に入れる（基準 3.6 の「20〜46度」を閉じた区間として読む）。 */
export const inJapan = ({ lat, lng }: LatLng): boolean =>
  lat >= JAPAN_BOUNDS.latMin && lat <= JAPAN_BOUNDS.latMax && lng >= JAPAN_BOUNDS.lngMin && lng <= JAPAN_BOUNDS.lngMax;
