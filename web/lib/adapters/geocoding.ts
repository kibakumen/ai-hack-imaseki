// 住所と場所の文字を位置へ直す実物（差し替え口 Geocoder）。Google の Geocoding API を
// `language=ja`・`region=jp` で呼び、最初の1件の位置を使う（設計書「比べた案」の地図の行）。
// 鍵を使うのはここだけで、画面には渡らない。打ち切りは呼ぶ側が AbortSignal で渡す
// （店の住所は usecases/saveStoreProfile、場所の文字は取得の手続き）。
//
// 0件・失敗・応答の形が違う、のどれも { ok: false }（「直せなかった」）へ倒す。
// 日本の範囲の外かどうかは呼ぶ側が domain/geo の inJapan で見る（基準 3.6・15.11）。

import type { Geocoder } from "../ports";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

type GeocodeResponse = {
  status?: unknown;
  results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }>;
};

export type GeocodingOptions = {
  /** Google の API の鍵（秘密。束縛から読む） */
  apiKey: string;
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
};

export const createGeocoder = ({ apiKey, fetch: fetchImpl = globalThis.fetch }: GeocodingOptions): Geocoder => ({
  geocode: async (text, opts) => {
    // 空の文字は外へ聞かずに「直せなかった」（呼ぶ側が断る）。
    if (text.trim() === "") return { ok: false };
    try {
      const url = new URL(GEOCODE_URL);
      url.searchParams.set("address", text);
      url.searchParams.set("language", "ja");
      url.searchParams.set("region", "jp");
      url.searchParams.set("key", apiKey);

      const res = await fetchImpl(url, { signal: opts.signal });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as GeocodeResponse;
      // ZERO_RESULTS・OVER_QUERY_LIMIT・REQUEST_DENIED はどれも「直せなかった」。
      if (json.status !== "OK") return { ok: false };
      const location = json.results?.[0]?.geometry?.location;
      if (typeof location?.lat !== "number" || typeof location?.lng !== "number") return { ok: false };
      return { ok: true, lat: location.lat, lng: location.lng };
    } catch {
      // 打ち切り・通信の失敗・JSON でない応答。
      return { ok: false };
    }
  },
});
