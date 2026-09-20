"use client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 速成版: 応答の形は画面側で仮定する
type ApiBody = any;

import { useCallback, useEffect, useState } from "react";

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export default function AdminPage() {
  const [key, setKey] = useState<string | null>(null);
  const [data, setData] = useState<ApiBody>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setKey(new URLSearchParams(window.location.search).get("key")), []);

  const load = useCallback(async () => {
    if (!key) return;
    const res = await fetch(`/api/admin?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const body: ApiBody = await res.json();
    if (!res.ok) return setError(body.error);
    setError(null);
    setData(body);
  }, [key]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const approve = async (storeId: string, approved: boolean) => {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, action: "approve", storeId, approved }),
    });
    await load();
  };

  if (!key) return <main className="p-6">運営の鍵つきの URL から開いてください。</main>;
  if (error) return <main className="p-6 text-red-600">{error}</main>;
  if (!data) return <main className="p-6">読み込み中…</main>;

  const nowMin = (() => {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();
  const isLive = (s: ApiBody) =>
    s.approved === 1 && s.offers.some((o: ApiBody) => o.active === 1 && o.remaining > 0 && o.start_min <= nowMin && nowMin < o.end_min);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-8">
      <header>
        <p className="text-xs text-neutral-500">運営の管理画面</p>
        <h1 className="text-2xl font-bold">席アキ v2 ・ 店の管理</h1>
      </header>

      <section className="grid grid-cols-4 gap-2 text-center">
        {[
          ["登録店", data.stores.length],
          ["承認済み", data.stores.filter((s: ApiBody) => s.approved === 1).length],
          ["公開中", data.stores.filter(isLive).length],
          ["登録客", data.customers],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-xl bg-neutral-100 py-3">
            <div className="text-2xl font-bold">{n as number}</div>
            <div className="text-xs text-neutral-500">{label as string}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        {data.stores.map((s: ApiBody) => (
          <article key={s.id} className="flex flex-col gap-2 rounded-2xl border border-neutral-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">
                  {s.name}
                  {isLive(s) && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">オファー公開中</span>}
                  {s.approved !== 1 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">承認待ち</span>}
                </h2>
                <p className="text-xs text-neutral-500">
                  {s.genre} ・ 1人{s.price_avg.toLocaleString()}円 ・ {s.address || "住所が未入力"} ・ 受け取り {s.claims}件
                </p>
              </div>
              <button
                onClick={() => approve(s.id, s.approved !== 1)}
                className={`rounded-lg px-4 py-2 text-sm font-bold ${s.approved === 1 ? "bg-neutral-200 text-neutral-700" : "bg-green-600 text-white"}`}
              >
                {s.approved === 1 ? "承認を取り消す" : "承認する"}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-bold text-neutral-500">オファー</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {s.offers.length === 0 && <li className="text-neutral-400">まだありません</li>}
                  {s.offers.map((o: ApiBody) => (
                    <li key={o.id} className={o.active === 1 ? "" : "text-neutral-400"}>
                      {o.title} ・ {o.party_size}名×残り{o.remaining} ・ {hhmm(o.start_min)}〜{hhmm(o.end_min)}
                      {o.active === 1 ? "" : "（停止中）"}
                      {o.coupon_note ? ` ・ ${o.coupon_note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-bold text-neutral-500">提供メニュー</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {s.menus.length === 0 && <li className="text-neutral-400">まだありません</li>}
                  {s.menus.map((m: ApiBody) => (
                    <li key={m.name}>
                      {m.name} ・ {m.price.toLocaleString()}円
                      {m.allergens?.length ? ` ・ ${m.allergens.join(",")}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
