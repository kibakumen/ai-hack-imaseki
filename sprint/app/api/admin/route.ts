import { NextResponse } from "next/server";
import { adminList, adminOk, approveStore } from "@/lib/db";

export const runtime = "nodejs";
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!adminOk(key)) return bad("鍵が違います", 401);
  return NextResponse.json(await adminList());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !adminOk(String(body.key ?? ""))) return bad("鍵が違います", 401);
  if (String(body.action ?? "") !== "approve") return bad("知らない操作です");
  const id = String(body.storeId ?? "");
  if (!id) return bad("店が分かりません");
  await approveStore(id, Boolean(body.approved));
  return NextResponse.json({ ok: true });
}
