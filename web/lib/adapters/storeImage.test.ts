// 店のホームページから雰囲気画像を取る実物（受け入れ検査は偽物に差し替えるので、ここだけが実物の
// 振る舞いを見る）。見るのは5つ: 当たったとき（画像のバイトまで取る）／scheme が違う・内部を指すときに断ること／
// リダイレクトを安全な行き先だけ追うこと／応答が読めない・形が違う・画像でない・大きすぎるときに断ること／
// 細工したページでも読み取りが線形に終わること（安全-04）。
import { describe, expect, it, vi } from "vitest";
import { STORE_IMAGE_MAX_BYTES } from "../schemas/limits";
import { createStoreImageFetcher } from "./storeImage";

const htmlResponse = (html: string, status = 200): Response => new Response(html, { status, headers: { "content-type": "text/html" } });

/** 小さな PNG（先頭の8バイトの印＋中身）。種類は先頭のバイトで決まる。 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const imageResponse = (bytes: Uint8Array = PNG, contentType = "image/png"): Response => new Response(bytes, { status: 200, headers: { "content-type": contentType } });

/**
 * ページ1枚と画像の組を返す偽の fetch。`images` に載った URL は画像、それ以外はページの HTML を返す。
 * 呼ばれた URL を控える（どこへ出たかを見る）。
 */
const site = (html: string, images: Record<string, () => Response> = {}) => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    const image = images[String(url)];
    return image ? image() : htmlResponse(html);
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
};

const gotPng = { ok: true, image: { body: PNG, contentType: "image/png" } };

describe("adapters/storeImage", () => {
  it("og:image が在れば、それを絶対 URL にして取りに行き、画像のバイトと種類を返す", async () => {
    const { fetchImpl, calls } = site('<html><head><meta property="og:image" content="/img/a.jpg"></head></html>', { "https://example.com/img/a.jpg": () => imageResponse() });
    const fetcher = createStoreImageFetcher({ fetch: fetchImpl });

    expect(await fetcher.fetch("https://example.com/store", {})).toEqual(gotPng);
    expect(calls).toEqual(["https://example.com/store", "https://example.com/img/a.jpg"]);
  });

  it("twitter:image しか無いときもそれを使う。属性の順が反転していても読む", async () => {
    const { fetchImpl, calls } = site('<meta content="https://cdn.example.com/b.png" name="twitter:image">', { "https://cdn.example.com/b.png": () => imageResponse() });
    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/store", {})).toEqual(gotPng);
    expect(calls.at(-1)).toBe("https://cdn.example.com/b.png");
  });

  it("種類は相手の名乗りでなく先頭のバイトで決める。SVG・HTML は画像と名乗っても断る（自分のオリジンから配るため）", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const { fetchImpl } = site('<meta property="og:image" content="/a.svg">', { "https://example.com/a.svg": () => imageResponse(svg, "image/svg+xml") });
    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });

    const lying = site('<meta property="og:image" content="/a.png">', { "https://example.com/a.png": () => imageResponse(new TextEncoder().encode("<html>x</html>"), "image/png") });
    expect(await createStoreImageFetcher({ fetch: lying.fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });

    // 名乗りが違っても中身が JPEG なら JPEG として受け取る
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const mislabeled = site('<meta property="og:image" content="/a.bin">', { "https://example.com/a.bin": () => imageResponse(jpeg, "application/octet-stream") });
    expect(await createStoreImageFetcher({ fetch: mislabeled.fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: true, image: { body: jpeg, contentType: "image/jpeg" } });
  });

  it("上限（2MB）を超える画像は取らない", async () => {
    const big = new Uint8Array(STORE_IMAGE_MAX_BYTES + 1);
    big.set(PNG);
    const { fetchImpl } = site('<meta property="og:image" content="/big.png">', { "https://example.com/big.png": () => imageResponse(big) });
    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });
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
    const { fetchImpl, calls } = site("<html></html>");
    await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.co.jp/", {});
    expect(calls).toEqual(["https://example.co.jp/"]);
  });

  it("リダイレクトは行き先を検査しながら手動で追う。安全な行き先が続けば辿る", async () => {
    const fetchImpl = (async (url: string) => {
      if (url === "https://example.com/") return new Response(null, { status: 302, headers: { location: "https://cdn.example.com/home" } });
      if (url === "https://cdn.example.com/home") return htmlResponse('<meta property="og:image" content="https://cdn.example.com/c.jpg">');
      if (url === "https://cdn.example.com/c.jpg") return imageResponse();
      throw new Error(`想定していない呼び出し: ${url}`);
    }) as unknown as typeof globalThis.fetch;

    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual(gotPng);
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

  it("画像の URL のリダイレクトも、行き先が内部アドレスならそこへは出ない", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url === "https://example.com/") return htmlResponse('<meta property="og:image" content="https://cdn.example.com/x.png">');
      return new Response(null, { status: 302, headers: { location: "http://10.0.0.5/secret.png" } });
    }) as unknown as typeof globalThis.fetch;

    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });
    expect(calls).toEqual(["https://example.com/", "https://cdn.example.com/x.png"]);
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

  it("og:image が無い・応答が失敗・通信が失敗・打ち切られた・画像の応答が失敗、のどれも取れなかったと答える", async () => {
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

    const imageMissing = site('<meta property="og:image" content="/gone.png">', { "https://example.com/gone.png": () => new Response("no", { status: 404 }) });
    expect(await createStoreImageFetcher({ fetch: imageMissing.fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });
  });

  it("抜き出した画像の URL が内部アドレスを指していたら、そこへは出ずに断る", async () => {
    const { fetchImpl, calls } = site('<meta property="og:image" content="http://169.254.169.254/latest/meta-data/">');
    expect(await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {})).toEqual({ ok: false });
    expect(calls).toEqual(["https://example.com/"]);
  });

  // 安全-04: 以前は `<meta[^>]+…[^>]+…` の多段の正規表現を本文にそのまま掛けていて、閉じない meta を並べた
  // ページで入力長のほぼ3乗の時間がかかった（20KB で約4秒）。同期で走るので、3秒の打ち切りでも止められない。
  describe("細工したページでも読み取りは線形に終わる（ReDoS・安全-04）", () => {
    const timed = async (html: string, images: Record<string, () => Response> = {}) => {
      const { fetchImpl } = site(html, images);
      const started = performance.now();
      const answer = await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", {});
      return { answer, ms: performance.now() - started };
    };

    it("閉じない meta を上限（200KB）まで並べたページでも 50ms 以内に終わり、取れなかったと答える", async () => {
      const { answer, ms } = await timed('<meta content="x" '.repeat(Math.ceil(200_000 / 18)));
      expect(answer).toEqual({ ok: false });
      expect(ms).toBeLessThan(50);
    });

    it("最後にだけ閉じる meta・属性の途中で切れた meta を並べたページでも 50ms 以内に終わる", async () => {
      for (const html of ['<meta content="x" '.repeat(10_000) + ">", '<meta property="og:image" content="'.repeat(5_000), "<meta ".repeat(30_000)]) {
        const { ms } = await timed(html);
        expect(ms, html.slice(0, 40)).toBeLessThan(50);
      }
    });

    it("大文字の META・一重引用符・= の前後の空白・ほかの属性が先にある形も読む", async () => {
      const { answer } = await timed(`<html><HEAD><Meta charset="utf-8"><META name = 'twitter:image' data-x="1" content = 'https://cdn.example.com/d.webp' /></HEAD>`, {
        "https://cdn.example.com/d.webp": () => imageResponse(),
      });
      expect(answer).toEqual(gotPng);
    });

    it("og:image でない meta は読み飛ばし、後ろの og:image を拾う", async () => {
      const { answer } = await timed('<meta name="description" content="店"><meta property="og:title" content="t"><meta property="og:image" content="/e.png">', {
        "https://example.com/e.png": () => imageResponse(),
      });
      expect(answer).toEqual(gotPng);
    });
  });

  it("打ち切りの合図をそのまま fetch に渡す（ページにも画像にも）", async () => {
    const calls: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push(init.signal);
      return url.endsWith(".png") ? imageResponse() : htmlResponse('<meta property="og:image" content="https://example.com/a.png">');
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();

    await createStoreImageFetcher({ fetch: fetchImpl }).fetch("https://example.com/", { signal: controller.signal });
    expect(calls).toEqual([controller.signal, controller.signal]);
  });
});
