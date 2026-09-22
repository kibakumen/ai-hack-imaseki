// 経路の出発地（2026-09-22）——①直前に探した起点をそのタブの中だけ覚える ②Googleマップの経路のリンクを組む。
//
// **なぜ覚えるか**: 確保が決まったあとの画面が出す「Googleマップで経路を開く」は、
// 出発地を渡さないと**マップが端末の現在地から引く**。現在地と違う場所で探した客には、
// まったく違う経路（実測で徒歩7時間）が出る。
//
// 探した起点は `FetchForm` が持っているが、**画面を読み直すと消える**——確保のあとに
// 再読み込みしたり、あとから確保の画面へ戻ってきたりすると、渡すものが無くなる。
// そこで `sessionStorage` に置いて、そのタブの中では読み直しても残るようにする。
//
// ⚠️ ここは**3段目の補い**（2026-09-22 の3回目の指摘のあと）。正本は**確保の応答に載る起点**
// （`ReservationDto.origin`・サーバーが `fetch_logs` から返す座標）で、新しいタブ・別のタブ・
// 保存を止めた端末でも渡る。ここが効くのは、古い応答や端末に残した古いホームに起点が無いときだけ。
//
// ⚠️ `sessionStorage` は private window や site data を止めている環境では**投げる**。
// 例外は握りつぶして「覚えていない」として扱う——飾りなので、落ちても経路そのものは開ける。
// ⚠️ タブを閉じれば消える（`localStorage` ではない）。**探した文脈と同じ寿命**にしてある。

/** 探した起点。座標か、客が打った場所の文字（マップの `origin` はどちらも受ける）。 */
export type SearchOrigin = { lat: number; lng: number } | { place: string };

/** 経路の行き先（確保の店名と住所）。 */
export type RouteDestination = { storeName: string; storeAddress: string };

/**
 * 経路を開くリンク（店名と住所で引く。出発地が分かっていれば渡す）。
 * 確定の演出（`ClaimedCelebration`）と確保中の画面（`ReservationView`）が**同じ1本**を使う——
 * 同じ役目のリンクを2か所で別々に組まない。
 *
 * ⚠️ **出発地を渡さないと、マップは端末の現在地から引く**（2026-09-22 の本人の指摘——
 * 現在地と違う場所を入れて探したのに、経路の開始地点が現在地になり、徒歩7時間と出た）。
 * 探した起点は座標のことも、客が打った場所の文字のこともある。マップの `origin` は
 * **どちらの形でも受ける**ので、そのまま渡す。分からないときは付けない（嘘の起点を付けるより、
 * マップに現在地から引かせる方がまし）。行き先が空なら null（リンクを出さない）。
 */
export const routeHref = (destination: RouteDestination, from: SearchOrigin | null): string | null => {
  const target = [destination.storeName, destination.storeAddress].filter((part) => part !== "").join(" ");
  if (target === "") return null;
  const params = new URLSearchParams({ api: "1", destination: target, travelmode: "walking" });
  if (from !== null) params.set("origin", "place" in from ? from.place : `${from.lat},${from.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

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
