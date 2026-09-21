// @vitest-environment jsdom
// 要件1 客の登録（画面）: 1.2・1.3・1.7 の画面・1.5・1.8・1.10・1.11。要件2 の 2.8（画面に識別子が無い）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, CUSTOMER, homeFetch, installFakeApi, invalidInput, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const publicConfig = () => ({ json: { turnstileSiteKey: "site-key-test", vapidPublicKey: "vapid-public-test", contactEmail: null } });

const renderApp = async (api: FakeApi) => {
  const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
  return render(<CustomerApp />);
};

const fill = (name: string, value: string) => fireEvent.change(screen.getByTestId(TID.field(name)), { target: { value } });

describeTask("3", "客の登録（画面）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("1.10・1.11 ホームが 401 なら登録の入力を出し、取得の画面は出さない", async () => {
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": () => ({ status: 401, json: { ok: false, error: { kind: "unauthorized" } } }) });
    await renderApp(api);
    await screen.findByTestId(TID.field("nickname"));
    expect(screen.queryByTestId(TID.field("place"))).toBeNull();
    expect(screen.queryByTestId(TID.btn("fetch"))).toBeNull();
  });

  it("1.8 登録済みなら取得の画面を出し、登録の入力は出ない", async () => {
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": () => ({ json: homeFetch() }) });
    await renderApp(api);
    await screen.findByTestId(TID.btn("fetch"));
    expect(screen.queryByTestId(TID.field("nickname"))).toBeNull();
  });

  it("1.5 登録の入力は決めた4つだけで、自由記述の複数行の欄とアレルギーの欄が無い", async () => {
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": () => ({ status: 401, json: { ok: false } }) });
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
    api = installFakeApi({
      "GET /api/config/public": publicConfig,
      "GET /api/customer/home": () => ({ status: 401, json: { ok: false } }),
      "POST /api/register/customer": () => invalidInput(fields),
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
    let registered = false;
    api = installFakeApi({
      "GET /api/config/public": publicConfig,
      "GET /api/customer/home": () => (registered ? { json: homeFetch() } : { status: 401, json: { ok: false } }),
      "POST /api/register/customer": () => {
        registered = true;
        return { status: 201, json: { ok: true } };
      },
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
    const posted = api.calls.find((c) => c.method === "POST" && c.path === "/api/register/customer")!;
    expect(posted.body).toMatchObject({ nickname: CUSTOMER.nickname, phone: CUSTOMER.phone });
  });
});
