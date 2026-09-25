// @vitest-environment jsdom
// 「開いた瞬間に今すぐ探すボタンを押せる」ことの検査（2026-09-22 の本人の指摘）。
//
// 受け入れ検査 `r01-customer-register.ui.test.tsx` も本番の入口としてこの1枚を描く（2026-09-25 設計-03）。
// こちらは部品の細部（呼び名と仮の値の形・二重に送らないこと）を見る。
//
// 見るのは5つ:
//   1. 識別子が無ければ、客に何も聞かずに登録を送る（呼び名は自動・電話番号は仮の値）
//   2. 登録が通れば、客が見るのは取得の画面（登録の入力は出ない）
//   3. 登録が断られたら、手で入れる登録の入力へ倒れる（受け皿）
//   4. 既に識別子を持っていれば、登録は送らない
//   5. ホームが読めなかった（500・internal／通信の失敗）だけなら、登録は送らない（2026-09-25 レビューの指摘）
//      ——登録すると新しい識別子の Cookie が今の Cookie を上書きし、確保中の客が店で見せるコードへ戻れなくなる
//   6. 確かめの値が無いなら登録を送らない／混み合って断られたら「混み合っています」を出す（2026-09-25 不具合-04）

import React, { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveHome } from "../../lib/client/reservationCache";
import { GuestEntry } from "./GuestEntry";
import { unauthorized as unauthorizedReply } from "../../../tests/acceptance/v2/_fakes";

type FakeResponse = { status?: number; json?: unknown } | "network-down";

type Call = { method: string; path: string; body: Record<string, unknown> | null };

const installFetch = (respond: (method: string, path: string) => FakeResponse) => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const out = respond(method, path);
    if (out === "network-down") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

/** サーバーが識別子の無い客に返す断り（http/refusals の unauthenticated と同じ形。形は受け入れ検査の道具の1か所から取る） */
const unauthorized: FakeResponse = unauthorizedReply();
const publicConfig: FakeResponse = { json: { turnstileSiteKey: "site-key-test", vapidPublicKey: "v", contactEmail: null } };
/** 取得の画面を出すホーム（客は登録済み）。 */
const homeFetch: FakeResponse = { json: { kind: "fetch", profile: { nickname: "guest-abc123", phone: "0000000000", genres: [], budgetMax: null } } };

/** Turnstile の代わり（実物と同じ形で、描かれた瞬間に値を1つ渡す）。 */
type TurnstileOptions = { callback: (token: string) => void; "error-callback"?: () => void };
type TurnstileWindow = Window & {
  turnstile?: { render: (el: HTMLElement, opts: TurnstileOptions) => string; reset: () => void; remove?: (id: string) => void };
};
const installTurnstile = () => {
  (window as TurnstileWindow).turnstile = {
    render: (_el, opts) => {
      opts.callback("tok-auto");
      return "widget-1";
    },
    reset: () => {},
  };
};

/** 端末に残した確保（店で見せるコードつき）。 */
const RESERVATION = {
  id: "res-1",
  code: "24681357",
  storeId: "store-1",
  storeName: "受け取りの店",
  storeAddress: "東京都渋谷区道玄坂1-1",
  storeUrl: null,
  party: 2,
  expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  status: "active",
  coupons: [],
};

const registerCalls = (calls: Call[]): Call[] => calls.filter((c) => c.method === "POST" && c.path === "/api/register/customer");

describe("客の画面の入口（登録を客に見せない）", () => {
  let fake: ReturnType<typeof installFetch> | null = null;

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
    delete (window as TurnstileWindow).turnstile;
    window.localStorage.clear();
    vi.useRealTimers();
  });

  /** 識別子が無い客の場面（登録が通れば取得の画面になる）。 */
  const installGuest = (register: () => FakeResponse = () => ({ status: 201, json: { ok: true } })) => {
    let registered = false;
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return registered ? homeFetch : unauthorized;
      if (method === "POST" && path === "/api/register/customer") {
        const out = register();
        if (out !== "network-down" && (out.status ?? 200) < 300) registered = true;
        return out;
      }
      return { status: 404, json: { ok: false } };
    });
  };

  it("識別子が無ければ、客に何も聞かずに登録を送る。呼び名は自動で作り、電話番号は形だけの仮の値", async () => {
    installTurnstile();
    let registered = false;
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return registered ? homeFetch : unauthorized;
      if (method === "POST" && path === "/api/register/customer") {
        registered = true;
        return { status: 201, json: { ok: true } };
      }
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await waitFor(() => expect(registerCalls(fake!.calls)).toHaveLength(1));

    const sent = registerCalls(fake!.calls)[0].body!;
    const nickname = String(sent.nickname);
    expect(nickname).toMatch(/^guest-[0-9a-z]{1,10}$/);
    // 呼び名の上限は schemas/limits.ts の NICKNAME_MAX（20字）
    expect(nickname.length).toBeLessThanOrEqual(20);
    // 形の正本は schemas/limits.ts の PHONE_PATTERN（0 で始まる10〜11桁）
    expect(String(sent.phone)).toMatch(/^0\d{9,10}$/);
    expect(sent.genres).toEqual([]);
    expect(sent.budgetMax).toBeNull();
    expect(sent.humanToken).toBe("tok-auto");
  });

  it("登録が通れば、客が見るのは取得の画面（登録の入力は出ない）", async () => {
    installTurnstile();
    let registered = false;
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return registered ? homeFetch : unauthorized;
      if (method === "POST" && path === "/api/register/customer") {
        registered = true;
        return { status: 201, json: { ok: true } };
      }
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("field-nickname")).toBeNull();
    expect(screen.queryByTestId("form-register")).toBeNull();
  });

  it("登録が断られたら、手で入れる登録の入力へ倒れる（受け皿）", async () => {
    installTurnstile();
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return unauthorized;
      if (method === "POST" && path === "/api/register/customer") return { status: 400, json: { ok: false, error: { kind: "human_check_failed" } } };
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await screen.findByTestId("field-nickname");
    expect(screen.queryByTestId("btn-fetch")).toBeNull();
  });

  // 不具合-04: 値の無い登録は必ず断られるうえ、以前は接続元の登録の回数を1回減らしていた。送らずに手の登録の入力を出す。
  it("人かどうかの確かめの値が無いなら、登録を送らずに手で入れる登録の入力を出す", async () => {
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return { json: { turnstileSiteKey: "", vapidPublicKey: "v", contactEmail: null } };
      if (path === "/api/customer/home") return unauthorized;
      if (method === "POST" && path === "/api/register/customer") return { status: 400, json: { ok: false, error: { kind: "human_check_failed" } } };
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await screen.findByTestId("field-nickname");
    expect(registerCalls(fake!.calls)).toHaveLength(0);
  });

  // 不具合-04: 同じ回線の客が多いと登録が 429 になる。手の登録の入力へ落とすと、客はもう一度送って同じ断りを受ける。
  it("登録が混み合って断られたら（429・rate_limited）、手の登録の入力へ落とさず「混み合っています」を出す", async () => {
    installTurnstile();
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return unauthorized;
      if (method === "POST" && path === "/api/register/customer") return { status: 429, json: { ok: false, error: { kind: "rate_limited" } } };
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    const busy = await screen.findByTestId("guest-entry-busy");
    expect(busy.textContent).toContain("混み合っています");
    expect(screen.queryByTestId("field-nickname")).toBeNull();
    expect(registerCalls(fake!.calls)).toHaveLength(1);
  });

  it("既に識別子を持っていれば、登録は送らずそのまま取得の画面を出す", async () => {
    installTurnstile();
    fake = installFetch((_method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return homeFetch;
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await screen.findByTestId("btn-fetch");
    expect(registerCalls(fake!.calls)).toHaveLength(0);
  });

  it.each<[string, FakeResponse]>([
    ["サーバーの不具合（500・internal）", { status: 500, json: { ok: false, error: { kind: "internal" } } }],
    ["通信の失敗", "network-down"],
  ])("確保を持つ客のホームが%sなら、登録は送らず、端末に残した確保と「確かめられていません」を出す", async (_label, homeFailure) => {
    installTurnstile();
    saveHome({ kind: "active", profile: { nickname: "guest-abc123", phone: "0000000000", genres: [], budgetMax: null }, reservation: RESERVATION });
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return homeFailure;
      if (method === "POST" && path === "/api/register/customer") return { status: 201, json: { ok: true } };
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    const view = await screen.findByTestId("view-active");
    expect(view.textContent).toContain(RESERVATION.code);
    expect(screen.getByTestId("stale-notice")).toBeTruthy();
    expect(registerCalls(fake!.calls)).toHaveLength(0);
  });

  // 不具合-22: 開発時の StrictMode は effect を「実行→片付け→再実行」する。1回目は片付けで止まり、
  // 2回目は「一度だけ走らせる印」で何もしないので、準備中のまま進まなかった。
  it("StrictMode（effect を実行→片付け→再実行）でも準備中で止まらず、登録は1回だけ送る", async () => {
    installTurnstile();
    installGuest();
    render(
      <StrictMode>
        <GuestEntry />
      </StrictMode>,
    );
    await screen.findByTestId("btn-fetch");
    expect(registerCalls(fake!.calls)).toHaveLength(1);
  });

  it("StrictMode でも、識別子を持っている客には取得の画面を出す", async () => {
    installTurnstile();
    fake = installFetch((_method, path) => (path === "/api/customer/home" ? homeFetch : path === "/api/config/public" ? publicConfig : { status: 404, json: { ok: false } }));
    render(
      <StrictMode>
        <GuestEntry />
      </StrictMode>,
    );
    await screen.findByTestId("btn-fetch");
    expect(registerCalls(fake!.calls)).toHaveLength(0);
  });

  // 客-02: 35%の濃さに縮めた部品と「準備をしています…」だけで最長15秒待たせ、押すよう促す文も無いまま
  // 登録の画面に落としていた。遅れて届いた値を拾う待ちも、部品ごと外していたので働いていなかった。
  it("確かめの値が3秒来なければ、部品を普通の濃さで見せて押すよう促し、部品を描いたまま待って、届いた値で登録する", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let deliver: ((token: string) => void) | null = null;
    (window as TurnstileWindow).turnstile = {
      render: (_el, opts) => {
        deliver = opts.callback;
        return "widget-1";
      },
      reset: () => {},
    };
    installGuest();
    const { container } = render(<GuestEntry />);
    await screen.findByTestId("human-check");
    expect(container.querySelector(".human-check-quiet")).toBeTruthy();
    expect(screen.queryByTestId("human-check-prompt")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });
    expect(screen.getByTestId("human-check-prompt").textContent).toMatch(/下の確認を押してください/);
    expect(container.querySelector(".human-check-quiet")).toBeNull();

    // 15秒を過ぎても登録の入力へ落とさず、部品を描いたまま待つ
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.queryByTestId("field-nickname")).toBeNull();
    expect(screen.getByTestId("human-check")).toBeTruthy();

    act(() => deliver!("tok-late"));
    await screen.findByTestId("btn-fetch");
    expect(registerCalls(fake!.calls)).toHaveLength(1);
    expect(registerCalls(fake!.calls)[0].body!.humanToken).toBe("tok-late");
  });

  it("確かめの部品が失敗を知らせたら（読み込めない・ホスト名が合わない等）、待たずに手で入れる登録の入力を出す", async () => {
    (window as TurnstileWindow).turnstile = {
      render: (_el, opts) => {
        opts["error-callback"]?.();
        return "widget-1";
      },
      reset: () => {},
    };
    installGuest();
    render(<GuestEntry />);
    await screen.findByTestId("field-nickname");
    expect(registerCalls(fake!.calls)).toHaveLength(0);
  });

  it("受け皿の登録の入力は、呼び名が自動で入っていて、電話番号は空のまま送れる（仮の番号を送る）", async () => {
    installTurnstile();
    let auto = true;
    installGuest(() => {
      if (auto) {
        auto = false;
        return { status: 400, json: { ok: false, error: { kind: "human_check_failed" } } };
      }
      return { status: 201, json: { ok: true } };
    });
    render(<GuestEntry />);
    const nickname = (await screen.findByTestId("field-nickname")) as HTMLInputElement;
    expect(nickname.value).toMatch(/^guest-[0-9a-z]{1,10}$/);
    expect((screen.getByTestId("field-phone") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).toMatch(/任意/);

    fireEvent.click(screen.getByTestId("btn-register"));
    await screen.findByTestId("btn-fetch");
    const manual = registerCalls(fake!.calls)[1].body!;
    expect(manual.nickname).toBe(nickname.value);
    expect(String(manual.phone)).toMatch(/^0\d{9,10}$/);
  });
});
