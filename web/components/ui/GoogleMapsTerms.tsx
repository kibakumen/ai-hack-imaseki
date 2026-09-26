// Google マップの機能を含むことの知らせ（2026-09-26 本人選択）。客向けの利用規約（app/terms）と店向けの利用規約
// （app/store/terms）が同じ1節を使う——同じ知らせを2か所で別々に書かない。
//
// 根拠: Google Maps Platform の利用規約 3.2.2(a)(i) は、アプリの利用規約で「Google マップの機能とコンテンツを含む」ことを
// 知らせ、その利用に Google Maps End User Additional Terms（https://maps.google.com/help/terms_maps/・日本語の題は
// 「Google マップ / Google Earth 追加利用規約」）と Google Privacy Policy（https://policies.google.com/privacy）が
// 適用されると書くことを求める（2026-09-26 に一次資料で確かめた）。
// 何が Google マップの機能かは実装から数えた（lib/adapters/geocoding の候補・位置と地名の相互の変換・
// lib/client/lastOrigin の経路のリンク）。機能を足したら、ここの並びも直す。

export const GOOGLE_MAPS_TERMS_URL = "https://maps.google.com/help/terms_maps/";
export const GOOGLE_PRIVACY_URL = "https://policies.google.com/privacy";

/** 見出しの段（客の規約と店の規約で、見出しの大きさを揃える） */
export const GoogleMapsTerms = () => (
  <section data-testid="terms-google-maps">
    <h2>Google マップの機能</h2>
    <p>
      イマセキは Google マップの機能とコンテンツ（場所の候補・場所の文字や現在地と位置の相互の変換・店の住所の位置への変換・Google マップでの経路の案内）を含みます。Google マップの機能とコンテンツの利用には、その時点の{" "}
      <a href={GOOGLE_MAPS_TERMS_URL} rel="noopener noreferrer" target="_blank">
        Google マップ / Google Earth 追加利用規約（Google Maps End User Additional Terms）
      </a>{" "}
      と{" "}
      <a href={GOOGLE_PRIVACY_URL} rel="noopener noreferrer" target="_blank">
        Google プライバシーポリシー
      </a>{" "}
      が適用されます。
    </p>
  </section>
);
