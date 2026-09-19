"use client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- デモ: API の応答は画面側で形を仮定する（負債に記録）
type ApiBody = any;

import { useCallback, useEffect, useState } from "react";

type Wave = { index: number; size: number; sentAt: number };
type Dashboard = {
  store: { name: string; genre: string; presets: { label: string }[] };
  registered: { total: number; real: number };
  config: { waveWaitSeconds: number; firstWaveSize: number; capPerSeat: number; radiusM: number };
  offer: null | {
    id: string; seats: number; perk: string; message: string; messageSource: string; llmCostUsd: number | null;
    createdAt: number; expiresAt: number; status: string; stopReason: string | null; cap: number; candidates: number; waves: Wave[]; lastCheckAt: number;
  };
  stats: null | { sent: number; opened: number; going: number; redeemed: number };
};

const STATUS_LABEL: Record<string, string> = {
  active: "配信中", stopped: "停止（残席0）", capped: "上限で自動停止", exhausted: "候補に配り終えた", expired: "期限切れ",
};

const hhmm = (t: number) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

export default function StorePage() {
  const [key, setKey] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seats, setSeats] = useState(3);
  const [preset, setPreset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setKey(new URLSearchParams(window.location.search).get("key")), []);

  const load = useCallback(async () => {
    if (!key) return;
    const res = await fetch(`/api/store?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const body: ApiBody = await res.json();
    if (!res.ok) return setError(body.error);
    setError(null);
    setData(body);
  }, [key]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      load();
      setNow(Date.now());
    }, 2000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    const res = await fetch("/api/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, ...payload }) });
    const body: ApiBody = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error);
    if (payload.action === "create") {
      setLastRun(`${body.evaluated}人を ${body.matchMs.toFixed(1)}ms で評価し、候補 ${body.candidates}人${body.messageNote ? `（${body.messageNote}）` : ""}`);
    }
    await load();
  };

  if (!key) return <main className="p-6">店の鍵つきの URL から開いてください。</main>;
  if (error && !data) return <main className="p-6 text-red-600">{error}</main>;
  if (!data) return <main className="p-6">読み込み中…</main>;

  const o = data.offer;
  const active = o?.status === "active";
  const nextWaveIn = o && active && o.waves.length > 0 ? Math.max(0, Math.ceil((o.lastCheckAt + data.config.waveWaitSeconds * 1000 - now) / 1000)) : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
      <header>
        <p className="text-xs text-neutral-500">店側 ・ 登録客 {data.registered.total}人（うち実機 {data.registered.real}人）</p>
        <h1 className="text-2xl font-bold">{data.store.name}</h1>
      </header>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {!active && (
        <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-bold">空席を知らせる</h2>
          <div className="grid grid-cols-1 gap-2">
            {data.store.presets.map((p, i) => (
              <button key={p.label} onClick={() => setPreset(i)}
                className={`rounded-xl border-2 px-4 py-3 text-left font-medium ${preset === i ? "border-orange-500 bg-orange-50" : "border-neutral-200"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">空席</span>
            <div className="flex items-center gap-4">
              <button aria-label="減らす" onClick={() => setSeats((s) => Math.max(1, s - 1))} className="h-12 w-12 rounded-full bg-neutral-100 text-2xl">−</button>
              <span className="w-10 text-center text-3xl font-bold">{seats}</span>
              <button aria-label="増やす" onClick={() => setSeats((s) => Math.min(20, s + 1))} className="h-12 w-12 rounded-full bg-neutral-100 text-2xl">＋</button>
            </div>
          </div>
          <p className="text-sm text-neutral-500">有効期限 30分 ・ 徒歩{data.config.radiusM}m以内 ・ 配信の上限 {seats * data.config.capPerSeat}人</p>
          <button disabled={busy} onClick={() => post({ action: "create", seats, presetIndex: preset })}
            className="rounded-2xl bg-orange-500 py-4 text-lg font-bold text-white disabled:opacity-50">
            {busy ? "送信中…" : "近くのお客さんに知らせる"}
          </button>
        </section>
      )}

      {o && (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">{active ? "配信中のオファー" : "直近のオファー"}</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${active ? "bg-green-100 text-green-700" : "bg-neutral-200 text-neutral-600"}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["配信", data.stats?.sent], ["開封", data.stats?.opened], ["行きます", data.stats?.going], ["来店", data.stats?.redeemed]].map(([label, n]) => (
              <div key={label as string} className="rounded-xl bg-neutral-100 py-3">
                <div className="text-2xl font-bold">{n ?? 0}</div>
                <div className="text-xs text-neutral-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-neutral-200 p-3 text-sm">
            <p className="text-neutral-500">
              通知文（{o.messageSource === "llm" ? "LLM・OrcaRouter" : "定型文"}
              {o.llmCostUsd !== null ? ` ・ $${o.llmCostUsd.toFixed(5)}` : ""}）
            </p>
            <p className="mt-1 font-medium">{o.message}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 p-3 text-sm">
            <p className="font-medium">配信の波（上限 {o.cap}人 ・ 候補 {o.candidates}人）</p>
            <ol className="mt-2 space-y-1">
              {o.waves.map((w) => (
                <li key={w.index} className="flex justify-between"><span>第{w.index}波 ・ {w.size}人</span><span className="text-neutral-500">{hhmm(w.sentAt)}</span></li>
              ))}
            </ol>
            {nextWaveIn !== null && <p className="mt-2 text-neutral-500">次の判定まで {nextWaveIn}秒（「行きます」が無ければ広げる）</p>}
            {o.stopReason && <p className="mt-2 text-neutral-600">停止の理由: {o.stopReason}</p>}
            {lastRun && <p className="mt-2 text-xs text-neutral-400">{lastRun}</p>}
          </div>
          {active && (
            <button disabled={busy} onClick={() => post({ action: "stop", offerId: o.id })}
              className="rounded-2xl bg-red-600 py-4 text-lg font-bold text-white disabled:opacity-50">
              残席0（配信を止める）
            </button>
          )}
          <p className="text-xs text-neutral-400">{hhmm(o.createdAt)} 開始 ・ {hhmm(o.expiresAt)} まで</p>
        </section>
      )}
    </main>
  );
}
