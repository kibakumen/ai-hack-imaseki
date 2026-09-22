// 直前に探した起点を、そのタブの中だけ覚えておく（2026-09-22）。
//
// **なぜ覚えるか**: 確保が決まったあとの画面が出す「Googleマップで経路を開く」は、
// 出発地を渡さないと**マップが端末の現在地から引く**。現在地と違う場所で探した客には、
// まったく違う経路（実測で徒歩7時間）が出る。
//
// 探した起点は `FetchForm` が持っているが、**画面を読み直すと消える**——確保のあとに
// 再読み込みしたり、あとから確保の画面へ戻ってきたりすると、渡すものが無くなる。
// そこで `sessionStorage` に置いて、そのタブの中では読み直しても残るようにする。
//
// ⚠️ `sessionStorage` は private window や site data を止めている環境では**投げる**。
// 例外は握りつぶして「覚えていない」として扱う——飾りなので、落ちても経路そのものは開ける。
// ⚠️ タブを閉じれば消える（`localStorage` ではない）。**探した文脈と同じ寿命**にしてある。

/** 探した起点。座標か、客が打った場所の文字（マップの `origin` はどちらも受ける）。 */
export type SearchOrigin = { lat: number; lng: number } | { place: string };

const KEY = "imaseki.lastOrigin";

export const rememberOrigin = (origin: SearchOrigin | null): void => {
  try {
    if (origin === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(origin));
  } catch {
    // 覚えられなくても探すのも受け取るのも止めない。
  }
};

/** 覚えている起点。形が壊れていたら null（読めなかったものを信じない）。 */
export const recallOrigin = (): SearchOrigin | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const point = parsed as { lat?: unknown; lng?: unknown; place?: unknown };
    if (typeof point.lat === "number" && typeof point.lng === "number") return { lat: point.lat, lng: point.lng };
    if (typeof point.place === "string" && point.place !== "") return { place: point.place };
    return null;
  } catch {
    return null;
  }
};
