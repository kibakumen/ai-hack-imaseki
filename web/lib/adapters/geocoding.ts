// 住所と場所の文字を位置へ直す実物（差し替え口 Geocoder）。Google の Geocoding API を
// `language=ja`・`region=jp` で呼び、最初の1件の位置を使う（設計書「比べた案」の地図の行）。
// 鍵を使うのはここだけで、画面には渡らない。打ち切りは呼ぶ側が AbortSignal で渡す
// （店の住所は usecases/saveStoreProfile、場所の文字は取得の手続き）。
//
// 0件・失敗・応答の形が違う、のどれも { ok: false }（「直せなかった」）へ倒す。
// 日本の範囲の外かどうかは呼ぶ側が domain/geo の inJapan で見る（基準 3.6・15.11）。

import type { Geocoder } from "../ports";
import { PLACE_SUGGEST_MAX } from "../schemas/limits";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
/** 場所の候補の1段目: Places API (New) の Autocomplete。鍵は見出し `X-Goog-Api-Key` で渡す */
const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
/**
 * Places に断られたことを覚える長さ（`adapters/orcarouter` の `judgeDeniedUntil` と同じ考え）。
 * 2026-09-22 の実測で、本番の鍵は Places（旧・新のどちらも）を**許可されていない**
 * （`REQUEST_DENIED`／`PERMISSION_DENIED`）。毎回2回呼ぶ無駄を避け、本人が Google Cloud で
 * Places API (New) を有効にしたら再デプロイ無しで1段目が使われるように、時間で忘れる。
 */
const PLACES_DENIED_MEMO_MS = 10 * 60 * 1000;

type GeocodeResponse = {
  status?: unknown;
  results?: Array<{ formatted_address?: unknown; geometry?: { location?: { lat?: unknown; lng?: unknown } } }>;
};

type PlacesAutocompleteResponse = {
  suggestions?: Array<{ placePrediction?: { text?: { text?: unknown } } }>;
  /** 新 API の断りの形（`{ error: { status: "PERMISSION_DENIED" } }`） */
  error?: { status?: unknown };
  /** 旧 API の断りの形（`{ status: "REQUEST_DENIED" }`）。念のため両方を見る */
  status?: unknown;
};

/** 1段目（Places）の答え。`denied` は鍵がこの API を許可されていない＝しばらく呼ばない */
type PlacesOutcome = { kind: "ok"; suggestions: string[] } | { kind: "denied" } | { kind: "failed" };

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
  /** 差し替え用（Places の拒否を覚える時計）。既定は実時計 */
  now?: () => number;
};

export const createGeocoder = ({ apiKey, fetch: fetchImpl = globalThis.fetch, now = Date.now }: GeocodingOptions): Geocoder => {
  // Places に断られた時刻の記憶（この差し替えが生きている間だけ。Worker の isolate ごと）
  let placesDeniedUntil = 0;

  /**
   * 1段目: Places API (New) の Autocomplete を1回呼ぶ。
   * 日本語・日本に絞る（`includedRegionCodes: ["jp"]` が旧 API の `components=country:jp` に当たる）。
   */
  const askPlaces = async (text: string, signal: AbortSignal | undefined): Promise<PlacesOutcome> => {
    try {
      const res = await fetchImpl(PLACES_AUTOCOMPLETE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey },
        body: JSON.stringify({ input: text, languageCode: "ja", regionCode: "jp", includedRegionCodes: ["jp"] }),
        signal,
      });
      const json = (await res.json().catch(() => null)) as PlacesAutocompleteResponse | null;
      // 鍵がこの API を許可されていない（HTTP 403 か、本文の status が拒否の語）。
      const status = json?.error?.status ?? json?.status;
      if (res.status === 403 || status === "PERMISSION_DENIED" || status === "REQUEST_DENIED") return { kind: "denied" };
      if (!res.ok || json === null) return { kind: "failed" };
      const suggestions = (json.suggestions ?? [])
        .map((s) => s.placePrediction?.text?.text)
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .slice(0, PLACE_SUGGEST_MAX);
      return { kind: "ok", suggestions };
    } catch {
      // 打ち切り・通信の失敗。
      return { kind: "failed" };
    }
  };

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

  /** 2段目: Geocoding で1件に解決し、それを候補1件として返す（Geocoding は1問い合わせにつき1件しか返さない） */
  const askGeocodingAsSuggestion = async (text: string, signal: AbortSignal | undefined): Promise<string[]> => {
    const results = await ask({ address: text, region: "jp" }, signal);
    const first = results?.[0]?.formatted_address;
    if (typeof first !== "string") return [];
    const label = shortenJapaneseAddress(first);
    return label === "" ? [] : [label];
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

    /**
     * 場所の候補（2段構え・2026-09-22 進行役の実測を受けた作り）。
     * ①Places API (New) の Autocomplete → 返れば最大5件。
     * ②鍵が Places を許可されていない（拒否）・その他の失敗なら Geocoding へ倒し、解決した1件を候補1件にする。
     * 拒否だけは10分覚えて①を飛ばす（`judgeDeniedUntil` と同じ）。どちらも取れなければ候補なし（`ok:true` の空）。
     * 呼ぶ側（usecases/placeSuggest）は `source` を記録にだけ残す。
     */
    suggest: async (text, opts) => {
      const trimmed = text.trim();
      if (trimmed === "") return { ok: true, suggestions: [], source: "geocoding" };
      if (now() >= placesDeniedUntil) {
        const places = await askPlaces(trimmed, opts.signal);
        if (places.kind === "ok") return { ok: true, suggestions: places.suggestions, source: "places" };
        if (places.kind === "denied") placesDeniedUntil = now() + PLACES_DENIED_MEMO_MS;
      }
      return { ok: true, suggestions: await askGeocodingAsSuggestion(trimmed, opts.signal), source: "geocoding" };
    },
  };
};
