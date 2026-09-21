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
  results?: Array<{ formatted_address?: unknown; geometry?: { location?: { lat?: unknown; lng?: unknown } } }>;
};

/**
 * Google が返す日本の住所から、客が自分の居場所として読める部分だけを残す。
 * 素の `formatted_address` は「日本、〒150-0043 東京都渋谷区道玄坂1丁目…」のように
 * 国名と郵便番号が前に付き、場所の欄に入れると一目で読めない（速成版 `sprint/lib/geo.ts` の
 * `normalizeJpAddress` と同じ整え方）。
 */
export const shortenJapaneseAddress = (raw: string): string =>
  raw
    .trim()
    .replace(/^日本[、,]?\s*/, "")
    .replace(/^〒?\s*\d{3}-?\d{4}\s*/, "")
    .trim();

export type GeocodingOptions = {
  /** Google の API の鍵（秘密。束縛から読む） */
  apiKey: string;
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
};

export const createGeocoder = ({ apiKey, fetch: fetchImpl = globalThis.fetch }: GeocodingOptions): Geocoder => {
  /** 問い合わせを1回投げて、当たった応答の `results` を返す（読めない・0件は null）。 */
  const ask = async (params: Record<string, string>, signal: AbortSignal | undefined): Promise<GeocodeResponse["results"] | null> => {
    try {
      const url = new URL(GEOCODE_URL);
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      url.searchParams.set("language", "ja");
      url.searchParams.set("key", apiKey);

      const res = await fetchImpl(url, { signal });
      if (!res.ok) return null;
      const json = (await res.json()) as GeocodeResponse;
      // ZERO_RESULTS・OVER_QUERY_LIMIT・REQUEST_DENIED はどれも「直せなかった」。
      if (json.status !== "OK") return null;
      return json.results ?? null;
    } catch {
      // 打ち切り・通信の失敗・JSON でない応答。
      return null;
    }
  };

  return {
    geocode: async (text, opts) => {
      // 空の文字は外へ聞かずに「直せなかった」（呼ぶ側が断る）。
      if (text.trim() === "") return { ok: false };
      const results = await ask({ address: text, region: "jp" }, opts.signal);
      const location = results?.[0]?.geometry?.location;
      if (typeof location?.lat !== "number" || typeof location?.lng !== "number") return { ok: false };
      return { ok: true, lat: location.lat, lng: location.lng };
    },

    // 逆方向（位置 → 地名）。`results[0]` がいちばん細かい住所。
    reverse: async (point, opts) => {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return { ok: false };
      const results = await ask({ latlng: `${point.lat},${point.lng}` }, opts.signal);
      const first = results?.[0]?.formatted_address;
      if (typeof first !== "string") return { ok: false };
      const label = shortenJapaneseAddress(first);
      return label === "" ? { ok: false } : { ok: true, label };
    },
  };
};
