// @vitest-environment jsdom
// 要件13（画面）: 13.3・13.9 の断りの表示、13.8 登録済みかどうかだけ。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, refusal, storeHomeDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

describeTask("7", "書類の画面", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const setup = async (home: any, routes: Record<string, any>) => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: home }), ...routes });
    const DocumentsPanel = await componentOf("components/store/DocumentsPanel", "DocumentsPanel");
    const r = render(<DocumentsPanel />);
    await screen.findByTestId(TID.field("file"));
    return r;
  };

  it("13.8 カードは登録済みかどうかだけが出て、番号や有効期限の欄が無い", async () => {
    const { container } = await setup(storeHomeDto({ status: "pending", checklist: { license: true, card: true } }), {});
    expect(screen.getByTestId("card-status").textContent).toMatch(/登録済み/);
    expect(container.textContent).not.toMatch(/カード番号|有効期限|セキュリティコード|CVC/);
    expect(container.querySelector("input[autocomplete='cc-number']")).toBeNull();
    expect(screen.getByTestId("license-status").textContent).toMatch(/登録済み|アップロード済み/);
  });

  it("13.3 file_unsupported／file_too_large はファイルの欄の直下に出て、書類の画面のまま、前のファイルの表示は変わらない。文が違う", async () => {
    let response: any = { status: 400, json: { ok: false, error: { kind: "file_unsupported", fields: [{ name: "file", reason: "not_allowed" }] } } };
    await setup(storeHomeDto({ status: "pending", checklist: { license: true, card: false } }), { "POST /api/store/license": () => response });
    const input = screen.getByTestId(TID.field("file")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], "a.gif", { type: "image/gif" })] } });
    fireEvent.click(screen.getByTestId(TID.btn("upload-license")));
    const a = (await screen.findByTestId(TID.msg("file"))).textContent;
    response = { status: 400, json: { ok: false, error: { kind: "file_too_large", fields: [{ name: "file", reason: "too_long" }] } } };
    fireEvent.click(screen.getByTestId(TID.btn("upload-license")));
    await waitFor(() => expect(screen.getByTestId(TID.msg("file")).textContent).not.toBe(a));
    expect(screen.getByTestId(TID.msg("file")).textContent).toMatch(/10\s*MB/);
    expect(screen.getByTestId("license-status").textContent).toMatch(/登録済み|アップロード済み/);
    expect(screen.getByTestId(TID.field("file"))).toBeTruthy();
  });

  it("13.9 card_setup_failed は「カードを登録する」の直下に出て、登録済みにならない", async () => {
    await setup(storeHomeDto({ status: "pending", checklist: { license: false, card: false } }), { "POST /api/store/card/setup": () => refusal("card_setup_failed") });
    fireEvent.click(screen.getByTestId(TID.btn("card-setup")));
    const form = screen.getByTestId(TID.form("card"));
    await waitFor(() => expect(form.querySelector(`[data-testid="${TID.msgForm}"]`)!.textContent).toMatch(/やり直/));
    expect(screen.getByTestId("card-status").textContent).not.toMatch(/登録済み/);
  });
});
