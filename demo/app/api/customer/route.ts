// 客側の API。登録（嗜好の構造化は LLM の入口）・受信箱・「開く／行きます／特典を使う」。
import { act, inbox, registerCustomer, type CustomerAction } from "@/lib/db";

const UUID = /^[0-9a-f-]{36}$/;
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return bad("客の ID が正しくありません");
  return Response.json({ items: await inbox(id) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("本文が読めません");
  if (body.action === "register") {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 20) : "";
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 300) : "";
    const spot = typeof body.spot === "string" ? body.spot.slice(0, 40) : "";
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!name || !text) return bad("名前と好みを書いてください");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat - 35.66) > 0.2 || Math.abs(lng - 139.7) > 0.2) return bad("位置は渋谷の周辺にしてください");
    const result = await registerCustomer({ name, text, spot, lat, lng });
    return result.ok ? Response.json(result) : bad(`読み取れませんでした（${result.reason}）。書き直してください`, 422);
  }
  const actions: CustomerAction[] = ["open", "going", "redeem"];
  if (actions.includes(body.action as CustomerAction) && typeof body.id === "string" && UUID.test(body.id) && typeof body.offerId === "string" && UUID.test(body.offerId)) {
    try {
      await act(body.id, body.offerId, body.action as CustomerAction);
      return Response.json({ ok: true });
    } catch (error) {
      return bad(error instanceof Error ? error.message : "失敗しました", 409);
    }
  }
  return bad("不明な操作です");
}
