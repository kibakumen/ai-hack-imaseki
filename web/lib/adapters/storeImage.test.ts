// 店のホームページから雰囲気画像を取る実物（受け入れ検査は偽物に差し替えるので、ここだけが実物の
// 振る舞いを見る）。見るのは4つ: 当たったとき／scheme が違う・内部を指すときに断ること／
// リダイレクトを安全な行き先だけ追うこと／応答が読めない・形が違うときに断ること。
import { describe, expect, it, vi } from "vitest";
import { createStoreImageFetcher } from "./storeImage";

const htmlResponse = (html: string, status = 200): Response => new Response(html, { status, headers: { "content-type": "text/html" } });

describe("adapters/storeImage", () => {
  it("og:image が在れば、それを絶対 URL にして返す", async () => {
    const fetchImpl = (async () => htmlResponse('<html><head><meta property="og:image" content="/img/a.jpg"></head></html>')) as unknown as typeof globalThis.fetch;
    const fetcher = createStoreImageFetcher({ fetch: fetchImpl });

    expect(await fetcher.fetch("https://example.com/store", {})).toEqual({ ok: true, imageUrl: "https://example.com/img/a.jpg" });
  });

  it("twitter:image しか無いときもそれを使う。属性の順が反転していても読む", async () => {
    const fetchImpl = (async () => htmlResponse('<meta content="https://cdn.example.com/b.png" name="twitter:image">')) as unknown as typeof globalThis.fetch;
    const fetcher = createStoreImageFetcher({ fetch: fetchImpl });

    expect(await fetcher.fetch("https://example.com/store", {})).toEqual({ ok: true, imageUrl: "https://cdn.example.com/b.png" });
  });

  it("http/https 以外の scheme は、外へ聞かずに断る", async () => {
    const fetchImpl = vi.fn();
    const fetcher = createStoreImageFetcher({ fetch: fetchImpl as unknown as typeof globalThis.fetch });

    for (const url of ["file:///etc/passwd", "ftp://example.com/a", "javascript:alert(1)", "not a url"]) {
      expect(await fetcher.fetch(url, {}), url).toEqual({ ok: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ループバック・プライベート帯・リンクローカル（クラウドのメタデータ含む）のホストは、外へ聞かずに断る", async () => {
    const fetchImpl = vi.fn();
    const fetcher = createStoreImageFetcher({ fetch: fetchImpl as unknown as typeof globalThis.fetch });

    const blocked = [
      "http://127.0.0.1/",
      "http://localhost/",
      "http://sub.localhost/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/", // クラウドのメタデータ
      "http://metadata.google.internal/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[::ffff:127.0.0.1]/",
    ];
    for (const url of blocked) expect(await fetcher.fetch(url, {}), url).toEqual({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("公開のホスト名はそのまま外へ聞く", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return htmlResponse("<html></html>");
    }) as unknown as typeof globalThis.fetch;
    await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.co.jp/", {});
    expect(calls).toEqual(["https://example.co.jp/"]);
  });

  it("リダイレクトは行き先を検査しながら手動で追う。安全な行き先が続けば辿り、内部を指したら断る", async () => {
    const fetchImpl = (async (url: string) => {
      if (url === "https://example.com/") return new Response(null, { status: 302, headers: { location: "https://cdn.example.com/home" } });
      if (url === "https://cdn.example.com/home") return htmlResponse('<meta property="og:image" content="https://cdn.example.com/c.jpg">');
      throw new Error(`想定していない呼び出し: ${url}`);
    }) as unknown as typeof globalThis.fetch;

    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: true, imageUrl: "https://cdn.example.com/c.jpg" });
  });

  it("リダイレクトの行き先が内部アドレスなら、そこへは出ずに断る", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as unknown as typeof globalThis.fetch;

    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });
    expect(calls).toEqual(["https://example.com/"]); // 内部アドレスへは1度も出ていない
  });

  it("リダイレクトが3回を超えて続くと断る", async () => {
    let hop = 0;
    const fetchImpl = (async () => {
      hop += 1;
      return new Response(null, { status: 302, headers: { location: `https://example.com/hop-${hop}` } });
    }) as unknown as typeof globalThis.fetch;

    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });
    expect(hop).toBeLessThanOrEqual(4); // 開始 + 3回まで
  });

  it("og:image が無い・応答が失敗・通信が失敗・打ち切られた、のどれも取れなかったと答える", async () => {
    const notFound = (async () => htmlResponse("<html><head></head></html>")) as unknown as typeof globalThis.fetch;
    expect(await createStoreImageFetcher({ fetch: notFound }).fetch("https://example.com/", {})).toEqual({ ok: false });

    const badGateway = (async () => new Response("bad gateway", { status: 502 })) as unknown as typeof globalThis.fetch;
    expect(await createStoreImageFetcher({ fetch: badGateway }).fetch("https://example.com/", {})).toEqual({ ok: false });

    const throws = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    expect(await createStoreImageFetcher({ fetch: throws }).fetch("https://example.com/", {})).toEqual({ ok: false });

    const aborted = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as typeof globalThis.fetch;
    expect(await createStoreImageFetcher({ fetch: aborted }).fetch("https://example.com/", {})).toEqual({ ok: false });
  });

  it("抜き出した画像の URL が内部アドレスを指していたら断る（<img src> に内部の値を渡さない）", async () => {
    const fetchImpl = (async () => htmlResponse('<meta property="og:image" content="http://169.254.169.254/latest/meta-data/">')) as unknown as typeof globalThis.fetch;
    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });
  });

  it("打ち切りの合図をそのまま fetch に渡す", async () => {
    const calls: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init.signal);
      return htmlResponse('<meta property="og:image" content="https://example.com/a.jpg">');
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();

    await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", { signal: controller.signal });
    expect(calls).toEqual([controller.signal]);
  });
});
