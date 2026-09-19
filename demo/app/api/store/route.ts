// 店側の API。ログイン画面の代わりに、店ごとの秘密の鍵（URL の key）を持つ要求だけ通す。
import { createOffer, dashboard, stopOffer, storeByKey } from "@/lib/db";

const deny = () => Response.json({ error: "店の鍵が正しくありません" }, { status: 401 });

export async function GET(request: Request) {
  const store = await storeByKey(new URL(request.url).searchParams.get("key"));
  if (!store) return deny();
  return Response.json(await dashboard(store));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = await storeByKey(typeof body?.key === "string" ? body.key : null);
  if (!store) return deny();
  try {
    if (body?.action === "create") {
      const seats = Number(body.seats);
      const presetIndex = Number(body.presetIndex);
      if (!Number.isInteger(seats) || seats < 1 || seats > 20) return Response.json({ error: "空席数は1〜20の整数にしてください" }, { status: 400 });
      if (![0, 1, 2].includes(presetIndex)) return Response.json({ error: "特典を選んでください" }, { status: 400 });
      return Response.json(await createOffer(store, seats, presetIndex));
    }
    if (body?.action === "stop" && typeof body.offerId === "string") {
      await stopOffer(store, body.offerId);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "不明な操作です" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "失敗しました" }, { status: 409 });
  }
}
