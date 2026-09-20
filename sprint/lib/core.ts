// v2 の速成版: 型と、決定論の絞り込み・点数づけ。
// 決まり: 距離800m・受付時間内・残り1以上・店が止めていない・運営が承認済み・アレルギー・予算・人数。

export const RADIUS_M = 800;
export const WALK_M_PER_MIN = 80;
export const GENRES = ["居酒屋", "ラーメン", "中華", "カフェ", "イタリアン", "焼肉", "寿司", "定食"] as const;
export const ALLERGENS = ["えび", "かに", "小麦", "そば", "卵", "乳", "落花生"] as const;

export type Menu = { name: string; price: number; allergens: string[] };
export type Prefs = { genres: string[]; budgetMax: number | null; allergies: string[]; summary: string };

export type Store = {
  id: string; name: string; genre: string; price_avg: number; address: string; url: string;
  lat: number; lng: number; menus: string; approved: number;
};

export type Offer = {
  id: string; store_id: string; title: string; party_size: number; qty: number; remaining: number;
  coupon_note: string; start_min: number; end_min: number; active: number; sort_order: number;
};

export type OfferView = Offer & { takeable: boolean; reason: string | null; recommended: boolean };
export type Candidate = { store: Store; menus: Menu[]; distance: number; walkMin: number; score: number; offers: OfferView[] };

export const parseMenus = (raw: string): Menu[] => {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as Menu[]) : [];
  } catch {
    return [];
  }
};

export const distanceMeters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/** 日本時間の「0:00 からの分」。受付時間の判定に使う */
export const jstMinutes = (now: number) => {
  const d = new Date(now + 9 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

export const inWindow = (offer: Offer, nowMin: number) => offer.start_min <= nowMin && nowMin < offer.end_min;

/** 食べられるものが1つも無い店だけ外す */
export const canEat = (menus: Menu[], allergies: string[]) =>
  menus.length === 0 || menus.some((m) => !(m.allergens ?? []).some((a) => allergies.includes(a)));

export const scoreOf = (distance: number, genre: string, prefs: Prefs) => {
  const distancePoint = Math.max(0, 60 * (1 - distance / RADIUS_M));
  const genrePoint = prefs.genres.length === 0 ? 20 : prefs.genres.includes(genre) ? 40 : 0;
  return Math.round((distancePoint + genrePoint) * 10) / 10;
};

/** 受け取れないオファーの理由（人数以外は一覧に出さない） */
const takeableReason = (offer: Offer, party: number, nowMin: number): string | null => {
  if (offer.active === 0) return "店が止めています";
  if (offer.remaining <= 0) return "残りがありません";
  if (!inWindow(offer, nowMin)) return "受付時間の外です";
  if (party > offer.party_size) return `${offer.party_size}名までのオファーです`;
  return null;
};

export type RankInput = {
  origin: { lat: number; lng: number };
  party: number;
  prefs: Prefs;
  now: number;
  stores: Store[];
  offers: Offer[];
};

/** 決定論の絞り込みと点数づけ。同点は距離が近い順、さらに同じなら店の id 順 */
export const rankStores = ({ origin, party, prefs, now, stores, offers }: RankInput): Candidate[] => {
  const nowMin = jstMinutes(now);
  const byStore = new Map<string, Offer[]>();
  offers.forEach((o) => byStore.set(o.store_id, [...(byStore.get(o.store_id) ?? []), o]));

  const candidates: Candidate[] = [];
  for (const store of stores) {
    if (store.approved !== 1) continue;
    const distance = distanceMeters(origin.lat, origin.lng, store.lat, store.lng);
    if (distance > RADIUS_M) continue;
    const menus = parseMenus(store.menus);
    if (!canEat(menus, prefs.allergies)) continue;
    if (prefs.budgetMax !== null && store.price_avg > prefs.budgetMax) continue;

    const all = (byStore.get(store.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const live = all.filter((o) => takeableReason(o, party, nowMin) === null);
    if (live.length === 0) continue; // 人数などで受け取れるものが1つも無い店は出さない

    // 一覧に出すのは、受け取れるものと「人数が合わない」ものだけ
    const shown = all.filter((o) => {
      const reason = takeableReason(o, party, nowMin);
      return reason === null || reason.endsWith("名までのオファーです");
    });
    const recommendedId = live[0].id; // 人数に合うもののうち、店が並べた順の先頭
    const offerViews: OfferView[] = shown.map((o) => {
      const reason = takeableReason(o, party, nowMin);
      return { ...o, takeable: reason === null, reason, recommended: o.id === recommendedId };
    });

    candidates.push({
      store,
      menus,
      distance,
      walkMin: Math.max(1, Math.round(distance / WALK_M_PER_MIN)),
      score: scoreOf(distance, store.genre, prefs),
      offers: offerViews,
    });
  }

  return candidates.sort((a, b) => b.score - a.score || a.distance - b.distance || a.store.id.localeCompare(b.store.id));
};

export const newCode = () => String(Math.floor(10_000_000 + Math.random() * 90_000_000));
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
