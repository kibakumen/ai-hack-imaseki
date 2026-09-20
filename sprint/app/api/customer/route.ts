import { NextResponse } from "next/server";
import { claim, getCustomer, myClaims, registerCustomer, search } from "@/lib/db";

export const runtime = "nodejs";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return bad("id がありません");
  const customer = await getCustomer(id);
  if (!customer) return bad("登録が見つかりません", 404);
  return NextResponse.json({
    id: customer.id,
    name: customer.name,
    prefs: customer.prefsParsed,
    source: customer.prefs_source,
    claims: await myClaims(id),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("本文が読めません");
  const action = String(body.action ?? "");

  if (action === "register") {
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const text = String(body.text ?? "").trim();
    if (!name || name.length > 20) return bad("呼び名は1〜20文字で入れてください");
    if (!/^[0-9-]{10,14}$/.test(phone)) return bad("電話番号は数字とハイフンで入れてください");
    if (!text || text.length > 300) return bad("好みは1〜300文字で入れてください");
    return NextResponse.json(await registerCustomer(name, phone, text));
  }

  if (action === "search") {
    const id = String(body.id ?? "");
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const party = Number(body.party);
    if (!id) return bad("登録が見つかりません");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad("場所が取れませんでした");
    if (!Number.isInteger(party) || party < 1 || party > 10) return bad("人数は1〜10で入れてください");
    return NextResponse.json(await search(id, lat, lng, party));
  }

  if (action === "claim") {
    const id = String(body.id ?? "");
    const offerId = String(body.offerId ?? "");
    const party = Number(body.party);
    if (!id || !offerId) return bad("受け取るオファーが分かりません");
    try {
      return NextResponse.json(await claim(id, offerId, Number.isInteger(party) ? party : 1));
    } catch (error) {
      return bad(error instanceof Error ? error.message : "受け取れませんでした", 409);
    }
  }

  return bad("知らない操作です");
}
