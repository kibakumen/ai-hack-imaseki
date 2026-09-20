"use client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 速成版: 応答の形は画面側で仮定する
type ApiBody = any;

import { useCallback, useEffect, useState } from "react";

const SPOTS = [
  { label: "渋谷駅 ハチ公口", lat: 35.659, lng: 139.7005 },
  { label: "センター街", lat: 35.6605, lng: 139.6985 },
  { label: "道玄坂上", lat: 35.6568, lng: 139.696 },
  { label: "恵比寿駅", lat: 35.6467, lng: 139.7101 },
];

const STORAGE_KEY = "sekiari-v2-me";

export default function MePage() {
  const [me, setMe] = useState<ApiBody>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("090-1234-5678");
  const [text, setText] = useState("がっつり系の居酒屋か中華が好き。1人4000円まで。えびアレルギーです");
  const [party, setParty] = useState(2);
  const [spot, setSpot] = useState(0);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiBody>(null);
  const [claims, setClaims] = useState<ApiBody[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMe(JSON.parse(saved));
    } catch {}
  }, []);

  const loadClaims = useCallback(async () => {
    if (!me?.id) return;
    const res = await fetch(`/api/customer?id=${me.id}`, { cache: "no-store" });
    if (!res.ok) return;
    const body: ApiBody = await res.json();
    setClaims(body.claims ?? []);
  }, [me?.id]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/customer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: ApiBody = await res.json();
    if (!res.ok) throw new Error(body.error ?? "うまくいきませんでした");
    return body;
  };

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = await post({ action: "register", name, phone, text });
      setMe(body);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(body));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録できませんでした");
    }
    setBusy(false);
  };

  const search = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const pos = here ?? SPOTS[spot];
    try {
      setResult(await post({ action: "search", id: me.id, lat: pos.lat, lng: pos.lng, party }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "探せませんでした");
    }
    setBusy(false);
  };

  const take = async (offerId: string) => {
    setError(null);
    try {
      const body = await post({ action: "claim", id: me.id, offerId, party });
      await loadClaims();
      alert(`${body.storeName}\nクーポン番号 ${body.code}\n${body.reused ? "（さきほど受け取った番号です）" : "店でこの番号を伝えてください"}`);
      await search();
    } catch (e) {
      setError(e instanceof Error ? e.message : "受け取れませんでした");
    }
  };

  if (!me) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-5 py-8">
        <h1 className="text-2xl font-bold">お客さん登録</h1>
        <p className="text-sm text-neutral-600">一度登録すれば、次からは「今すぐ探す」だけです。</p>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">呼び名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="たなか" className="rounded-xl border border-neutral-300 px-3 py-3" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">電話番号（店からの連絡用）</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-xl border border-neutral-300 px-3 py-3" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">好み・予算・アレルギー（自由に書く）</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-xl border border-neutral-300 px-3 py-3" />
        </label>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy || !name} onClick={register} className="rounded-2xl bg-orange-500 py-4 text-lg font-bold text-white disabled:opacity-50">
          {busy ? "読み取り中…" : "登録する"}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{me.name} さん</h1>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {}
            setMe(null);
            setResult(null);
          }}
          className="text-xs text-neutral-400 underline"
        >
          登録し直す
        </button>
      </header>

      <section className="rounded-xl bg-neutral-100 p-3 text-sm">
        <p className="text-neutral-500">読み取った好み（{me.source === "llm" ? "AI・OrcaRouter" : "規則"}）</p>
        <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1">
          <dt className="text-neutral-500">ジャンル</dt>
          <dd>{me.prefs.genres.join("・") || "こだわらない"}</dd>
          <dt className="text-neutral-500">予算の上限</dt>
          <dd>{me.prefs.budgetMax ? `${me.prefs.budgetMax.toLocaleString()}円` : "指定なし"}</dd>
          <dt className="text-neutral-500">アレルギー</dt>
          <dd>{me.prefs.allergies.join("・") || "なし"}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium">何人で行く？</span>
          <div className="flex items-center gap-3">
            <button aria-label="減らす" onClick={() => setParty((p) => Math.max(1, p - 1))} className="h-11 w-11 rounded-full bg-neutral-100 text-2xl">−</button>
            <span className="w-8 text-center text-2xl font-bold">{party}</span>
            <button aria-label="増やす" onClick={() => setParty((p) => Math.min(10, p + 1))} className="h-11 w-11 rounded-full bg-neutral-100 text-2xl">＋</button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">いる場所</span>
          <select
            value={spot}
            onChange={(e) => {
              setSpot(Number(e.target.value));
              setHere(null);
            }}
            className="rounded-xl border border-neutral-300 px-3 py-3"
          >
            {SPOTS.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition(
                (p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude }),
                () => setError("現在地を取れませんでした。駅を選んでください"),
                { timeout: 3000 },
              )
            }
            className="self-start text-sm text-orange-600 underline"
          >
            {here ? "現在地を使います（取得済み）" : "現在地を使う"}
          </button>
        </div>
        <button disabled={busy} onClick={search} className="rounded-2xl bg-orange-500 py-4 text-lg font-bold text-white disabled:opacity-50">
          {busy ? "探しています…" : "今すぐ探す"}
        </button>
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <section className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">
            {result.evaluated}店を {result.matchMs.toFixed(1)}ms で評価 ・ 候補 {result.candidates}店 ・{" "}
            {result.aiUsed ? `AI が選定${result.costUsd !== null ? `（$${result.costUsd.toFixed(5)}）` : ""}` : "AI が使えず点数順"}
          </p>
          {result.items.length === 0 && (
            <p className="rounded-xl bg-neutral-100 p-4 text-sm">
              いまこの場所で受け取れるオファーは見つかりませんでした。人数を減らすか、場所を変えると見つかるかもしれません。
            </p>
          )}
          {result.items.map((item: ApiBody) => (
            <article key={item.storeId} className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4">
              <div className="flex justify-between text-xs text-neutral-500">
                <span>{item.genre} ・ 1人 {item.priceAvg.toLocaleString()}円</span>
                <span>徒歩{item.walkMin}分（{item.distance}m）</span>
              </div>
              <h2 className="text-lg font-bold">{item.name}</h2>
              <p className="text-sm text-neutral-700">{item.reason}</p>
              <p className="text-xs text-neutral-500">{item.menus.map((m: ApiBody) => m.name).join("・")}</p>
              <div className="flex flex-col gap-2">
                {item.offers.map((o: ApiBody) => (
                  <div key={o.id} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${o.takeable ? "border-orange-200 bg-orange-50" : "border-neutral-200 bg-neutral-50 text-neutral-400"}`}>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {o.recommended && <span className="mr-1 rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">おすすめ</span>}
                        {o.title}
                      </span>
                      <span className="text-xs">{o.partySize}名×残り{o.remaining} ・ {o.window}{o.couponNote ? ` ・ ${o.couponNote}` : ""}</span>
                    </div>
                    {o.takeable ? (
                      <button onClick={() => take(o.id)} className="shrink-0 rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white">
                        受け取る
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs">{o.reason}</span>
                    )}
                  </div>
                ))}
              </div>
              {item.address && (
                <p className="text-xs text-neutral-500">
                  {item.address}
                  {item.url && (
                    <>
                      {" ・ "}
                      <a href={item.url} className="underline" target="_blank" rel="noreferrer">
                        ホームページ
                      </a>
                    </>
                  )}
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {claims.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">受け取ったクーポン</h2>
          {claims.map((c: ApiBody) => (
            <div key={c.code} className="rounded-xl border border-neutral-200 p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{c.store_name}</span>
                <span className={c.used_at ? "text-green-700" : "text-orange-600"}>{c.used_at ? "使用済み" : "未使用"}</span>
              </div>
              <p className="mt-1">{c.title}{c.coupon_note ? ` ・ ${c.coupon_note}` : ""}</p>
              <p className="mt-1 text-2xl font-bold tracking-widest">{c.code}</p>
              <p className="text-xs text-neutral-500">{c.address}</p>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
