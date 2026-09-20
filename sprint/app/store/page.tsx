"use client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 速成版: 応答の形は画面側で仮定する
type ApiBody = any;

import { useCallback, useEffect, useState } from "react";
import { GENRES } from "@/lib/core";

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
};

export default function StorePage() {
  const [key, setKey] = useState<string | null>(null);
  const [data, setData] = useState<ApiBody>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ApiBody>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => setKey(new URLSearchParams(window.location.search).get("key")), []);

  const load = useCallback(async () => {
    if (!key) return;
    const res = await fetch(`/api/store?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const body: ApiBody = await res.json();
    if (!res.ok) return setError(body.error);
    setError(null);
    setData(body);
    setForm({
      address: body.store.address,
      url: body.store.url,
      genre: body.store.genre,
      priceAvg: body.store.price_avg,
      menus: body.store.menus.map((m: ApiBody) => `${m.name} ${m.price} ${(m.allergens ?? []).join(",")}`.trim()).join("\n"),
    });
  }, [key]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, ...payload }),
    });
    const body: ApiBody = await res.json();
    if (!res.ok) {
      setError(body.error);
      return null;
    }
    setError(null);
    await load();
    return body;
  };

  if (!key) return <main className="p-6">店の鍵つきの URL から開いてください。</main>;
  if (error && !data) return <main className="p-6 text-red-600">{error}</main>;
  if (!data || !form) return <main className="p-6">読み込み中…</main>;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-5 py-8">
      <header>
        <p className="text-xs text-neutral-500">店の画面{data.store.approved ? "" : " ・ 運営の承認待ち（まだ客に出ません）"}</p>
        <h1 className="text-2xl font-bold">{data.store.name}</h1>
      </header>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{note}</p>}

      <section className="grid grid-cols-3 gap-2 text-center">
        {[["結果に出た", data.stats.shown], ["受け取り", data.stats.claimed], ["来店", data.stats.used]].map(([label, n]) => (
          <div key={label as string} className="rounded-xl bg-neutral-100 py-3">
            <div className="text-2xl font-bold">{n as number}</div>
            <div className="text-xs text-neutral-500">{label as string}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-bold">店の情報</h2>
        <label className="flex flex-col gap-1 text-sm">
          住所
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-lg border border-neutral-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          ホームページの URL
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="rounded-lg border border-neutral-300 px-3 py-2" />
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            ジャンル
            <select value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} className="rounded-lg border border-neutral-300 px-3 py-2">
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            1人あたりの目安
            <input type="number" value={form.priceAvg} onChange={(e) => setForm({ ...form, priceAvg: Number(e.target.value) })} className="rounded-lg border border-neutral-300 px-3 py-2" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          提供メニュー（1行に「名前 値段 アレルゲン,アレルゲン」）
          <textarea value={form.menus} onChange={(e) => setForm({ ...form, menus: e.target.value })} rows={5} className="rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs" />
        </label>
        <button
          onClick={async () => {
            if (await post({ action: "save-store", ...form })) setNote("店の情報を保存しました");
          }}
          className="rounded-xl bg-neutral-900 py-3 font-bold text-white"
        >
          店の情報を保存
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">オファー（3つまで）</h2>
        {data.offers.map((o: ApiBody) => (
          <OfferCard key={o.id} offer={o} onSave={(f) => post({ action: "save-offer", id: o.id, ...f })} onToggle={(active) => post({ action: "toggle", offerId: o.id, active })} />
        ))}
        {data.offers.length < 3 && <OfferCard onSave={(f) => post({ action: "save-offer", ...f })} />}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-bold">受け取ったお客さん</h2>
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="8桁の番号" className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 tracking-widest" />
          <button
            onClick={async () => {
              if (await post({ action: "mark-used", code })) {
                setNote(`${code} を使用済みにしました`);
                setCode("");
              }
            }}
            className="rounded-lg bg-orange-500 px-4 py-2 font-bold text-white"
          >
            使用済みに
          </button>
        </div>
        <div className="flex flex-col divide-y divide-neutral-100 text-sm">
          {data.claims.length === 0 && <p className="text-neutral-500">まだありません。</p>}
          {data.claims.map((c: ApiBody) => (
            <div key={c.code} className="flex items-center justify-between gap-2 py-2">
              <div className="flex flex-col">
                <span className="font-medium">
                  {c.customer_name} さん（{c.party}名） ・ {c.title}
                </span>
                <span className="text-xs text-neutral-500">
                  {c.phone} ・ {new Date(c.claimed_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <span className={`shrink-0 font-mono text-lg ${c.used_at ? "text-neutral-400 line-through" : ""}`}>{c.code}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

type OfferForm = { title: string; partySize: number; qty: number; couponNote: string; startMin: number; endMin: number };

function OfferCard({ offer, onSave, onToggle }: { offer?: ApiBody; onSave: (f: OfferForm) => void; onToggle?: (active: boolean) => void }) {
  const [f, setF] = useState<OfferForm>({
    title: offer?.title ?? "",
    partySize: offer?.party_size ?? 2,
    qty: offer?.qty ?? 3,
    couponNote: offer?.coupon_note ?? "",
    startMin: offer?.start_min ?? 17 * 60,
    endMin: offer?.end_min ?? 22 * 60,
  });

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 p-4">
      <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="サービス内容（例: ドリンク1杯無料）" className="rounded-lg border border-neutral-300 px-3 py-2 font-medium" />
      <div className="flex items-center gap-2 text-sm">
        <input type="number" min={1} max={10} value={f.partySize} onChange={(e) => setF({ ...f, partySize: Number(e.target.value) })} className="w-16 rounded-lg border border-neutral-300 px-2 py-2" />
        <span>名 ×</span>
        <input type="number" min={1} max={50} value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} className="w-16 rounded-lg border border-neutral-300 px-2 py-2" />
        <span>組{offer ? `（残り ${offer.remaining}）` : ""}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <input type="time" value={hhmm(f.startMin)} onChange={(e) => setF({ ...f, startMin: toMin(e.target.value) })} className="rounded-lg border border-neutral-300 px-2 py-2" />
        <span>〜</span>
        <input type="time" value={hhmm(f.endMin)} onChange={(e) => setF({ ...f, endMin: toMin(e.target.value) })} className="rounded-lg border border-neutral-300 px-2 py-2" />
      </div>
      <input value={f.couponNote} onChange={(e) => setF({ ...f, couponNote: e.target.value })} placeholder="食べログなどのクーポン番号（手入力・後からでも可）" className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <button onClick={() => onSave(f)} className="flex-1 rounded-lg bg-neutral-900 py-2 font-bold text-white">
          {offer ? "保存（個数を入れ直すと残りも戻ります）" : "オファーを追加"}
        </button>
        {offer && onToggle && (
          <button onClick={() => onToggle(offer.active !== 1)} className={`rounded-lg px-4 py-2 font-bold ${offer.active === 1 ? "bg-red-600 text-white" : "bg-green-600 text-white"}`}>
            {offer.active === 1 ? "公開を止める" : "公開する"}
          </button>
        )}
      </div>
    </div>
  );
}
