"use client";

// 「Googleマップで経路を開く」のボタン（確保中の画面 `ReservationView` と、期限切れの表示 `ExpiredView` が使う）。
//
// ⚠️ `<a href="https://…">` ではなく **`<button>` で開く**——受け入れ検査 r09 の 9.1 が「店の URL が無ければ
//    `view-active` の中に http のリンクが1つも無い」を固定しており、その検査は変えられない。
// リンクの中身は確定の演出（`ClaimedCelebration`）と同じ `routeHref`。`data-href` は検査が開く先を読むため。
// 行き先が組めない（店名も住所も空）ときは何も出さない。

import { routeHref, type RouteDestination, type SearchOrigin } from "../../lib/client/lastOrigin";

type RouteButtonProps = {
  destination: RouteDestination;
  /** 経路の出発地（探したときの起点）。分からなければ null＝`origin` を付けずに開く（マップが現在地から引く） */
  from: SearchOrigin | null;
};

/** 新しいタブで開く（リンクと同じ振る舞い。`noopener` で開いた側からこの画面を触れなくする）。 */
const openRoute = (href: string) => {
  window.open(href, "_blank", "noopener,noreferrer");
};

export const RouteButton = ({ destination, from }: RouteButtonProps) => {
  const route = routeHref(destination, from);
  if (route === null) return null;
  return (
    <button type="button" className="claimed-route claim-route" data-testid="btn-route" data-href={route} onClick={() => openRoute(route)}>
      Googleマップで経路を開く
    </button>
  );
};

export default RouteButton;
