// @vitest-environment jsdom
// 要件1 客の登録（画面）: 1.2・1.3・1.7 の画面・1.5・1.8・1.10・1.11。要件2 の 2.8（画面に識別子が無い）。
// 描くのは本番の入口（GuestEntry）。登録の入力は、自動の登録が通らなかったときの受け皿として出る（本人の決定 2026-09-22）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, CUSTOMER, homeFetch, installFakeApi, invalidInput, unauthorized, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const publicConfig = () => ({ json: { turnstileSiteKey: "site-key-test", vapidPublicKey: "vapid-public-test", contactEmail: null } });

/**
 * **本番の入口の部品**（/me の GuestEntry）を描く（2026-09-25 設計-03）。以前は中の CustomerApp だけを描いていて、
 * 開いた瞬間に裏で登録を済ませる道（本人の決定 2026-09-22）を一度も通っていなかった。
 * 登録の入力は、自動の登録が通らなかったときの受け皿として出る。
 */
const renderApp = async (_api: FakeApi) => {
  const GuestEntry = await componentOf("components/customer/GuestEntry", "GuestEntry");
  return render(<GuestEntry />);
};

/** Turnstile の代わり（描かれた瞬間に値を1つ渡す） */
type TurnstileWindow = Window & { turnstile?: { render: (el: HTMLElement, opts: { callback: (token: string) => void }) => string; reset: () => void } };
const installTurnstile = () => {
  (window as TurnstileWindow).turnstile = {
    render: (_el, opts) => {
      opts.callback("tok-auto");
      return "widget-1";
    },
    reset: () => {},
  };
};
/** 入口が裏で送る自動の登録か（呼び名を自動で作る） */
const isAutoRegistration = (body: any) => typeof body?.nickname === "string" && body.nickname.startsWith("guest-");
/** 自動の登録を断る（人の確かめに落ちた形）。客が手で送る登録は `manual` に任せる */
const autoRefused =
  (manual: (body: any) => { status?: number; json?: unknown } = () => ({ status: 201, json: { ok: true } })) =>
  ({ body }: { body: any }) =>
    isAutoRegistration(body) ? { status: 400, json: { ok: false, error: { kind: "human_check_failed" } } } : manual(body);

const fill = (name: string, value: string) => fireEvent.change(screen.getByTestId(TID.field(name)), { target: { value } });

describeTask("3", "客の登録（画面）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
    delete (window as TurnstileWindow).turnstile;
  });

  it("1.10・1.11 ホームが 401 なら、客に何も聞かずに裏で登録を送り（人の確かめの値つき）、通れば取得の画面へ移る。登録の入力は見せない", async () => {
    installTurnstile();
    let registered = false;
    api = installFakeApi({
      "GET /api/config/public": publicConfig,
      "GET /api/customer/home": () => (registered ? { json: homeFetch() } : unauthorized()),
      "POST /api/register/customer": () => {
        registered = true;
        return { status: 201, json: { ok: true } };
      },
    });
    await renderApp(api);
    await screen.findByTestId(TID.btn("fetch"));
    expect(screen.queryByTestId(TID.field("nickname"))).toBeNull();
    const posted = api.calls.filter((c) => c.method === "POST" && c.path === "/api/register/customer");
    expect(posted).toHaveLength(1);
    expect(isAutoRegistration(posted[0].body)).toBe(true);
    expect(posted[0].body.humanToken).toBe("tok-auto");
  });

  it("1.10・1.11 自動の登録が通らなければ、登録の入力を出し、取得の画面は出さない", async () => {
    installTurnstile();
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": unauthorized, "POST /api/register/customer": autoRefused() });
    await renderApp(api);
    await screen.findByTestId(TID.field("nickname"));
    expect(screen.queryByTestId(TID.field("place"))).toBeNull();
    expect(screen.queryByTestId(TID.btn("fetch"))).toBeNull();
  });

  it("1.8 登録済みなら取得の画面を出し、登録は送らず、登録の入力も出ない", async () => {
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": () => ({ json: homeFetch() }) });
    await renderApp(api);
    await screen.findByTestId(TID.btn("fetch"));
    expect(screen.queryByTestId(TID.field("nickname"))).toBeNull();
    expect(api.calls.filter((c) => c.path === "/api/register/customer")).toHaveLength(0);
  });

  it("1.5 登録の入力は決めた4つだけで、自由記述の複数行の欄とアレルギーの欄が無い", async () => {
    installTurnstile();
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": unauthorized, "POST /api/register/customer": autoRefused() });
    const { container } = await renderApp(api);
    await screen.findByTestId(TID.field("nickname"));
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/アレルギー|アレルゲン/);
    const inputs = [...container.querySelectorAll("input")].filter((i) => i.type !== "checkbox" && i.type !== "hidden" && i.type !== "submit");
    expect(inputs.map((i) => i.getAttribute("data-testid")).sort()).toEqual([TID.field("budgetMax"), TID.field("nickname"), TID.field("phone")]);
    expect(within(screen.getByTestId(TID.field("genres"))).getAllByRole("checkbox")).toHaveLength(12);
  });

  it("1.2・1.3・1.7 断りの応答で、その欄の直下にだけ文が出て、入れた内容が残り、登録の入力のまま、送るボタンは押せる。fields を変えると出る欄が変わる", async () => {
    let fields: Array<{ name: string; reason: string }> = [{ name: "nickname", reason: "too_long" }];
    installTurnstile();
    api = installFakeApi({
      "GET /api/config/public": publicConfig,
      "GET /api/customer/home": unauthorized,
      "POST /api/register/customer": autoRefused(() => invalidInput(fields)),
    });
    await renderApp(api);
    await screen.findByTestId(TID.field("nickname"));
    fill("nickname", "あ".repeat(21));
    fill("phone", "09012345678");
    fill("budgetMax", "3000");
    fireEvent.click(within(screen.getByTestId(TID.field("genres"))).getAllByRole("checkbox")[0]);
    const submit = screen.getByTestId(TID.btn("register"));
    fireEvent.click(submit);
    await screen.findByTestId(TID.msg("nickname"));
    expect(screen.getByTestId(TID.msg("nickname")).textContent!.length).toBeGreaterThan(0);
    expect(screen.queryByTestId(TID.msg("phone"))).toBeNull();
    expect(screen.queryByTestId(TID.msg("budgetMax"))).toBeNull();
    expect((screen.getByTestId(TID.field("nickname")) as HTMLInputElement).value).toBe("あ".repeat(21));
    expect((screen.getByTestId(TID.field("phone")) as HTMLInputElement).value).toBe("09012345678");
    expect((screen.getByTestId(TID.field("budgetMax")) as HTMLInputElement).value).toBe("3000");
    expect((within(screen.getByTestId(TID.field("genres"))).getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId(TID.btn("fetch"))).toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fields = [{ name: "phone", reason: "bad_format" }];
    fireEvent.click(submit);
    await screen.findByTestId(TID.msg("phone"));
    await waitFor(() => expect(screen.queryByTestId(TID.msg("nickname"))).toBeNull());

    fields = [
      { name: "nickname", reason: "too_short" },
      { name: "phone", reason: "bad_format" },
      { name: "budgetMax", reason: "out_of_range" },
    ];
    fireEvent.click(submit);
    await screen.findByTestId(TID.msg("budgetMax"));
    expect(screen.getByTestId(TID.msg("nickname")).textContent).not.toBe(screen.getByTestId(TID.msg("phone")).textContent);
    for (const m of ["nickname", "phone", "budgetMax"]) expect(screen.getByTestId(TID.msg(m)).textContent).not.toMatch(/不正|誤り|無効/);
  });

  it("通る応答では文が無く、登録のあとホームを取り直して取得の画面へ移る。2.8 画面に識別子の値が出ない", async () => {
    installTurnstile();
    let registered = false;
    api = installFakeApi({
      "GET /api/config/public": publicConfig,
      "GET /api/customer/home": () => (registered ? { json: homeFetch() } : unauthorized()),
      "POST /api/register/customer": autoRefused(() => {
        registered = true;
        return { status: 201, json: { ok: true } };
      }),
    });
    const { container } = await renderApp(api);
    await screen.findByTestId(TID.field("nickname"));
    fill("nickname", CUSTOMER.nickname);
    fill("phone", CUSTOMER.phone);
    fireEvent.click(screen.getByTestId(TID.btn("register")));
    await screen.findByTestId(TID.btn("fetch"));
    expect(screen.queryByTestId(TID.msg("nickname"))).toBeNull();
    // 2.8: 識別子は HttpOnly の Cookie にあり、画面の側は値を受け取らない。応答に値が無いことは r02 の入口の検査で見る。
    expect(container.textContent).not.toMatch(/識別子|token|cookie/i);
    const posted = api.calls.filter((c) => c.method === "POST" && c.path === "/api/register/customer").find((c) => !isAutoRegistration(c.body))!;
    expect(posted.body).toMatchObject({ nickname: CUSTOMER.nickname, phone: CUSTOMER.phone });
  });
});
