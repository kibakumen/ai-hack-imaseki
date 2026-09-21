// @vitest-environment jsdom
// 要件15（画面）: 15.2・15.4・15.7・15.8・15.10 の断りの表示、15.12 無い欄。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, invalidInput, PROFILE, refusal, type FakeApi } from "./_fakes";
import { TID } from "./_types";

describeTask("5", "店の情報のフォーム", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const setup = async (responder: () => any) => {
    api = installFakeApi({ "GET /api/store/profile": () => ({ json: { profile: { ...PROFILE, menus: ["刺身盛り"] } } }), "PUT /api/store/profile": responder });
    const ProfileForm = await componentOf("components/store/ProfileForm", "ProfileForm");
    const r = render(<ProfileForm />);
    await screen.findByTestId(TID.field("name"));
    return r;
  };

  it("15.12 値段・アレルゲンつきの提供メニューの欄と、目安料金の欄が無い。おすすめメニューは1件ずつ足す形", async () => {
    const { container } = await setup(() => ({ json: { ok: true } }));
    expect(container.textContent).not.toMatch(/アレルゲン|アレルギー|目安料金|値段/);
    expect(screen.getByTestId(TID.field("menu"))).toBeTruthy();
    expect(screen.getByTestId(TID.btn("add-menu"))).toBeTruthy();
    expect(screen.getByTestId(TID.field("budgetMin"))).toBeTruthy();
    expect(screen.getByTestId(TID.field("budgetMax"))).toBeTruthy();
  });

  it("断りの応答（name・address・url・budgetMin〔min_over_max〕・budgetMax・menus too_many を1つずつと同時／address_unresolved）で、その欄の直下にだけ文が出て、入れた6項目が残る。6件目は足す操作の直下", async () => {
    let response: any = invalidInput([{ name: "name", reason: "too_long" }]);
    await setup(() => response);
    fireEvent.change(screen.getByTestId(TID.field("name")), { target: { value: "新しい店名" } });
    fireEvent.change(screen.getByTestId(TID.field("address")), { target: { value: "新しい住所" } });
    fireEvent.change(screen.getByTestId(TID.field("url")), { target: { value: "https://example.com/new" } });
    fireEvent.change(screen.getByTestId(TID.field("budgetMin")), { target: { value: "5000" } });
    fireEvent.change(screen.getByTestId(TID.field("budgetMax")), { target: { value: "4000" } });
    const save = screen.getByTestId(TID.btn("save-profile"));
    const fields = ["name", "address", "url", "budgetMin", "budgetMax"];
    for (const field of fields) {
      response = invalidInput([{ name: field, reason: field === "budgetMin" ? "min_over_max" : field === "url" ? "bad_format" : "too_long" }]);
      fireEvent.click(save);
      await screen.findByTestId(TID.msg(field));
      for (const other of fields.filter((f) => f !== field)) await waitFor(() => expect(screen.queryByTestId(TID.msg(other))).toBeNull());
    }
    response = invalidInput(fields.map((name) => ({ name, reason: "too_long" })));
    fireEvent.click(save);
    await screen.findByTestId(TID.msg("budgetMax"));
    for (const f of fields) expect(screen.getByTestId(TID.msg(f))).toBeTruthy();
    expect((screen.getByTestId(TID.field("name")) as HTMLInputElement).value).toBe("新しい店名");
    expect((screen.getByTestId(TID.field("address")) as HTMLInputElement).value).toBe("新しい住所");
    expect((screen.getByTestId(TID.field("url")) as HTMLInputElement).value).toBe("https://example.com/new");
    expect((screen.getByTestId(TID.field("budgetMin")) as HTMLInputElement).value).toBe("5000");
    expect((screen.getByTestId(TID.field("budgetMax")) as HTMLInputElement).value).toBe("4000");
    expect(screen.getByTestId(TID.form("profile")).textContent).toContain("刺身盛り");

    response = refusal("address_unresolved", { fields: [{ name: "address", reason: "not_allowed" }] });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByTestId(TID.msg("address")).textContent).toMatch(/住所|入れ直|やり直/));

    response = invalidInput([{ name: "menus", reason: "too_many" }]);
    fireEvent.change(screen.getByTestId(TID.field("menu")), { target: { value: "6件目" } });
    fireEvent.click(screen.getByTestId(TID.btn("add-menu")));
    fireEvent.click(save);
    await screen.findByTestId(TID.msg("menus"));
    expect(screen.getByTestId(TID.msg("menus")).textContent).toMatch(/5/);
  });

  it("通る応答では文が無い", async () => {
    await setup(() => ({ json: { ok: true, profile: PROFILE } }));
    fireEvent.click(screen.getByTestId(TID.btn("save-profile")));
    await screen.findByTestId("profile-saved");
    expect(screen.queryByTestId(TID.msg("name"))).toBeNull();
    expect(screen.queryByTestId(TID.msgForm)).toBeNull();
  });
});
