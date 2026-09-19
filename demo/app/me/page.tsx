"use client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- デモ: API の応答は画面側で形を仮定する（負債に記録）
type ApiBody = any;

import { useCallback, useEffect, useRef, useState } from "react";

// 位置は常時追跡しない。登録時に場所を選ぶか、ボタンで1回だけ現在地を取る
const SPOTS = [
  { label: "渋谷駅 ハチ公口", lat: 35.659, lng: 139.7005 },
  { label: "センター街", lat: 35.6605, lng: 139.6985 },
  { label: "道玄坂上", lat: 35.6568, lng: 139.696 },
  { label: "宮益坂", lat: 35.6605, lng: 139.7045 },
  { label: "代官山（徒歩圏の外）", lat: 35.649, lng: 139.703 },
];

type Me = { id: string; name: string; prefs: { genres: string[]; budgetMax: number | null; allergies: string[] }; source: string; note?: string };
type Item = {
  offer_id: string; store_name: string; message: string; message_source: string; perk: string; status: string; expires_at: number;
  distance_m: number; wave: number; sent_at: number; opened_at: number | null; going_at: number | null; redeemed_at: number | null;
};

const STORAGE_KEY = "sekiari-me";

export default function MePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("がっつり系と居酒屋が好き。予算は4000円まで。甲殻類アレルギーです");
  const [spot, setSpot] = useState(0);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const loaded = useRef(false); // 最初の読み込みでは通知しない

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMe(JSON.parse(saved));
    } catch {}
  }, []);

  const register = async () => {
    setBusy(true);
    setError(null);
    const pos = here ?? SPOTS[spot];
    const res = await fetch("/api/customer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", name, text, spot: here ? "現在地" : SPOTS[spot].label, lat: pos.lat, lng: pos.lng }),
    });
    const body: ApiBody = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error);
    const next: Me = { id: body.id, name, prefs: body.prefs, source: body.source, note: body.note };
    setMe(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  };

  const load = useCallback(async () => {
    if (!me) return;
    const res = await fetch(`/api/customer?id=${me.id}`, { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { items: Item[] };
    const fresh = body.items.filter((i) => !seen.current.has(i.offer_id));
    if (loaded.current) {
      fresh.forEach((i) => {
        try { if ("Notification" in window && Notification.permission === "granted") new Notification(i.store_name, { body: i.message }); } catch {}
      });
    }
    fresh.forEach((i) => seen.current.add(i.offer_id));
    loaded.current = true;
    setItems(body.items);
  }, [me]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (offerId: string, action: "open" | "going" | "redeem") => {
    const res = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: me?.id, offerId }) });
    const body: ApiBody = await res.json();
    setError(res.ok ? null : body.error);
    load();
  };

  if (!me) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-bold">お客さん登録</h1>
        <label className="flex flex-col gap-1"><span className="text-sm font-medium">呼び名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-neutral-300 px-3 py-3" placeholder="たなか" />
        </label>
        <label className="flex flex-col gap-1"><span className="text-sm font-medium">好み・予算・アレルギー（自由に書く）</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-xl border border-neutral-300 px-3 py-3" />
        </label>
        <div className="flex flex-col gap-1"><span className="text-sm font-medium">いる場所</span>
          <select value={spot} onChange={(e) => { setSpot(Number(e.target.value)); setHere(null); }} className="rounded-xl border border-neutral-300 px-3 py-3">
            {SPOTS.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
          </select>
          <button type="button" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setError("現在地を取れませんでした"))}
            className="self-start text-sm text-orange-600 underline">{here ? "現在地を使う（取得済み）" : "現在地を1回だけ使う"}</button>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy || !name} onClick={register} className="rounded-2xl bg-orange-500 py-4 text-lg font-bold text-white disabled:opacity-50">
          {busy ? "読み取り中…" : "登録する"}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{me.name} さん</h1>
        <button onClick={() => { try { localStorage.removeItem(STORAGE_KEY); } catch {} setMe(null); setItems([]); }} className="text-xs text-neutral-400 underline">登録し直す</button>
      </header>
      <section className="rounded-xl bg-neutral-100 p-3 text-sm">
        <p className="text-neutral-500">読み取った好み（{me.source === "llm" ? "LLM・OrcaRouter" : "規則"}）{me.note ? ` ・ ${me.note}` : ""}</p>
        <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1">
          <dt className="text-neutral-500">ジャンル</dt><dd>{me.prefs.genres.join("・") || "こだわらない"}</dd>
          <dt className="text-neutral-500">予算の上限</dt><dd>{me.prefs.budgetMax ? `${me.prefs.budgetMax.toLocaleString()}円` : "指定なし"}</dd>
          <dt className="text-neutral-500">アレルギー</dt><dd>{me.prefs.allergies.join("・") || "なし"}</dd>
        </dl>
      </section>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <h2 className="font-bold">届いたお知らせ</h2>
      {items.length === 0 && <p className="text-sm text-neutral-500">まだありません。近くのお店が空席を出すと、ここに届きます。</p>}
      {items.map((i) => {
        const live = ["active", "capped", "exhausted"].includes(i.status) && Date.now() < i.expires_at;
        return (
          <article key={i.offer_id} onClick={() => !i.opened_at && act(i.offer_id, "open")} className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4">
            <div className="flex justify-between text-xs text-neutral-500"><span>{i.store_name} ・ {i.distance_m}m</span><span>第{i.wave}波</span></div>
            <p className="font-medium">{i.message}</p>
            <p className="text-sm text-orange-700">特典: {i.perk}</p>
            {i.redeemed_at ? <p className="font-bold text-green-700">使用済み。ご来店ありがとうございます</p>
              : !live ? <p className="text-sm text-neutral-500">このお知らせは終了しました（満席または期限切れ）</p>
              : (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={(e) => { e.stopPropagation(); act(i.offer_id, "going"); }} disabled={Boolean(i.going_at)}
                    className="rounded-xl bg-orange-500 py-3 font-bold text-white disabled:bg-orange-200">{i.going_at ? "向かっています" : "行きます"}</button>
                  <button onClick={(e) => { e.stopPropagation(); act(i.offer_id, "redeem"); }} className="rounded-xl border-2 border-orange-500 py-3 font-bold text-orange-600">特典を使う</button>
                </div>
              )}
          </article>
        );
      })}
    </main>
  );
}
