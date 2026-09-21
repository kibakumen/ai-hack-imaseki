// 住所を位置へ直す実物（受け入れ検査は偽物に差し替えるので、ここだけが実物の振る舞いを見る）。
// 見るのは5つ: 空の文字／当たったとき／0件のとき／応答の形が違うとき／外が答えなかったとき。
// 日本の範囲の外かどうかはここでは見ない（呼ぶ側の domain/geo が見る・基準 15.11）。
import { describe, expect, it, vi } from "vitest";
import { createGeocoder } from "./geocoding";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("adapters/geocoding", () => {
  it("空の文字は、外へ聞かずに直せなかったと答える", async () => {
    const fetchImpl = vi.fn();
    const geocoder = createGeocoder({ apiKey: "key", fetch: fetchImpl as unknown as typeof globalThis.fetch });
    expect(await geocoder.geocode("   ", {})).toEqual({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("当たったら最初の1件の位置を返す。住所・日本語・日本・鍵を送り、打ち切りの合図をそのまま渡す", async () => {
    const calls: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), signal: init.signal });
      // 2件返っても最初の1件だけを使う。
      return jsonResponse({ status: "OK", results: [{ geometry: { location: { lat: 35.6595, lng: 139.7005 } } }, { geometry: { location: { lat: 1, lng: 2 } } }] });
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();

    const result = await createGeocoder({ apiKey: "key-1", fetch: fetchImpl }).geocode("東京都渋谷区道玄坂1-1", { signal: controller.signal });

    expect(result).toEqual({ ok: true, lat: 35.6595, lng: 139.7005 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("maps.googleapis.com");
    expect(calls[0].url).toContain(`address=${encodeURIComponent("東京都渋谷区道玄坂1-1")}`);
    expect(calls[0].url).toContain("language=ja");
    expect(calls[0].url).toContain("region=jp");
    expect(calls[0].url).toContain("key=key-1");
    expect(calls[0].signal).toBe(controller.signal);
  });

  it("0件（status が OK でない）は直せなかったと答える", async () => {
    for (const status of ["ZERO_RESULTS", "OVER_QUERY_LIMIT", "REQUEST_DENIED"]) {
      const fetchImpl = (async () => jsonResponse({ status, results: [] })) as unknown as typeof globalThis.fetch;
      expect(await createGeocoder({ apiKey: "k", fetch: fetchImpl }).geocode("どこにもない住所", {}), status).toEqual({ ok: false });
    }
  });

  it("位置の形が違うときは直せなかったと答える", async () => {
    for (const body of [{ status: "OK", results: [] }, { status: "OK", results: [{}] }, { status: "OK", results: [{ geometry: { location: { lat: "35.6", lng: 139.7 } } }] }]) {
      const fetchImpl = (async () => jsonResponse(body)) as unknown as typeof globalThis.fetch;
      expect(await createGeocoder({ apiKey: "k", fetch: fetchImpl }).geocode("住所", {}), JSON.stringify(body)).toEqual({ ok: false });
    }
  });

  it("状態が 200 でない・JSON でない・通信が失敗したときは直せなかったと答える", async () => {
    const errorResponse = (async () => new Response("bad gateway", { status: 502 })) as unknown as typeof globalThis.fetch;
    expect(await createGeocoder({ apiKey: "k", fetch: errorResponse }).geocode("住所", {})).toEqual({ ok: false });

    const notJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof globalThis.fetch;
    expect(await createGeocoder({ apiKey: "k", fetch: notJson }).geocode("住所", {})).toEqual({ ok: false });

    const throws = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    expect(await createGeocoder({ apiKey: "k", fetch: throws }).geocode("住所", {})).toEqual({ ok: false });

    // 打ち切りで投げた場合も同じ（呼ぶ側が AbortSignal を渡す）。
    const aborted = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as typeof globalThis.fetch;
    expect(await createGeocoder({ apiKey: "k", fetch: aborted }).geocode("住所", {})).toEqual({ ok: false });
  });
});
