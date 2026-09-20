import { NextResponse } from "next/server";
import { markUsed, saveOffer, saveStore, storeByKey, storeDashboard, toggleOffer } from "@/lib/db";
import { GENRES, type Menu } from "@/lib/core";

export const runtime = "nodejs";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const store = await storeByKey(key);
  if (!store) return bad("鍵が違います", 401);
  return NextResponse.json(await storeDashboard(store));
}

/** 「唐揚げ 680 小麦,卵」の形の行を、メニューに直す */
const parseMenuLines = (text: string): Menu[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((line) => {
      const [name, price, allergens] = line.split(/\s+/);
      return { name: name ?? "", price: Number(price) || 0, allergens: (allergens ?? "").split(",").map((a) => a.trim()).filter(Boolean) };
    })
    .filter((m) => m.name);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("本文が読めません");
  const store = await storeByKey(String(body.key ?? ""));
  if (!store) return bad("鍵が違います", 401);
  const action = String(body.action ?? "");

  if (action === "save-store") {
    const genre = String(body.genre ?? "");
    const priceAvg = Number(body.priceAvg);
    if (!GENRES.includes(genre as (typeof GENRES)[number])) return bad("ジャンルが正しくありません");
    if (!Number.isFinite(priceAvg) || priceAvg <= 0 || priceAvg > 100000) return bad("1人あたりの目安の値段が正しくありません");
    await saveStore(store.id, {
      address: String(body.address ?? "").slice(0, 120),
      url: String(body.url ?? "").slice(0, 200),
      genre,
      priceAvg: Math.round(priceAvg),
      menus: parseMenuLines(String(body.menus ?? "")),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "save-offer") {
    const title = String(body.title ?? "").trim();
    const partySize = Number(body.partySize);
    const qty = Number(body.qty);
    const startMin = Number(body.startMin);
    const endMin = Number(body.endMin);
    if (!title || title.length > 40) return bad("サービス内容は1〜40文字で入れてください");
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 10) return bad("1組の人数は1〜10で入れてください");
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) return bad("個数は1〜50で入れてください");
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin >= endMin) return bad("受付時間が正しくありません");
    try {
      const id = await saveOffer(store.id, {
        id: body.id ? String(body.id) : undefined,
        title,
        partySize,
        qty,
        couponNote: String(body.couponNote ?? "").slice(0, 60),
        startMin,
        endMin,
      });
      return NextResponse.json({ ok: true, id });
    } catch (error) {
      return bad(error instanceof Error ? error.message : "保存できませんでした");
    }
  }

  if (action === "toggle") {
    await toggleOffer(store.id, String(body.offerId ?? ""), Boolean(body.active));
    return NextResponse.json({ ok: true });
  }

  if (action === "mark-used") {
    try {
      await markUsed(store.id, String(body.code ?? "").trim());
      return NextResponse.json({ ok: true });
    } catch (error) {
      return bad(error instanceof Error ? error.message : "使用済みにできませんでした", 409);
    }
  }

  return bad("知らない操作です");
}
