// @vitest-environment jsdom
// 要件13（画面）: 13.3・13.9 の断りの表示、13.8 登録済みかどうかだけ。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  // 2026-09-25 カード登録が画面から完了しない件（不具合-01）: 決済会社の画面から戻り先（`?card=returned`）へ戻ったら、
  // 画面が番号なしで確かめを送り、通れば登録済みの表示に変わる。
  it("不具合-01 決済会社から戻り先へ戻ると、画面が番号なしで確かめを送り、登録済みの表示に変わる。戻った印は URL から消える", async () => {
    window.history.replaceState({}, "", "/store/documents?card=returned");
    let registered = false;
    await setup(storeHomeDto({ status: "pending", checklist: { license: true, card: false } }), {
      "GET /api/store/home": () => ({ json: storeHomeDto({ status: "pending", checklist: { license: true, card: registered }, cardSetupPending: !registered }) }),
      "POST /api/store/card/confirm": () => {
        registered = true;
        return { json: { ok: true, cardRegistered: true } };
      },
    });
    await waitFor(() => expect(screen.getByTestId("card-status").textContent).toMatch(/登録済み/));
    const confirms = api.calls.filter((c) => c.path === "/api/store/card/confirm");
    expect(confirms).toHaveLength(1);
    expect(confirms[0].body ?? {}).toEqual({});
    expect(window.location.search).not.toMatch(/card=returned/);
    window.history.replaceState({}, "", "/");
  });

  it("不具合-01 戻ったのに確かめが通らなければ、「カードを登録する」の直下にやり直しの文が出て、登録済みにならない", async () => {
    window.history.replaceState({}, "", "/store/documents?card=returned");
    await setup(storeHomeDto({ status: "pending", checklist: { license: true, card: false }, cardSetupPending: true }), { "POST /api/store/card/confirm": () => refusal("card_setup_failed") });
    const form = screen.getByTestId(TID.form("card"));
    await waitFor(() => expect(form.querySelector(`[data-testid="${TID.msgForm}"]`)?.textContent ?? "").toMatch(/やり直/));
    expect(screen.getByTestId("card-status").textContent).not.toMatch(/登録済み/);
    window.history.replaceState({}, "", "/");
  });

  it("不具合-01 戻らずにタブを閉じた店でも、書類の画面を開けば確かめを1回送る（cardSetupPending）。始めていない店には送らない", async () => {
    await setup(storeHomeDto({ status: "pending", checklist: { license: true, card: false }, cardSetupPending: true }), { "POST /api/store/card/confirm": () => refusal("card_setup_failed") });
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/store/card/confirm")).toHaveLength(1));
    // 戻り先から来たのではないので、通らなくても断りの文は出さない（入力を終えていないだけかもしれない）
    expect(screen.getByTestId(TID.form("card")).querySelector(`[data-testid="${TID.msgForm}"]`)?.textContent ?? "").not.toMatch(/やり直/);
    cleanup();
    api.restore();
    await setup(storeHomeDto({ status: "pending", checklist: { license: true, card: false }, cardSetupPending: false }), {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.calls.filter((c) => c.path === "/api/store/card/confirm")).toHaveLength(0);
  });

  // 2026-09-25 営業許可書が消える道が無い件（安全-20）: 書類の画面に、保管の目的・消す時・連絡先を書き、
  // 承認の前の店には「営業許可書を消す」を置く（確かめてから消す）。カードは今は請求しないことも書く（店-21）。
  it("安全-20 書類の画面に許可書の使い道と消す時が書かれ、承認の前の店は確かめてから許可書を消せる。承認済みの店には消す操作が無い", async () => {
    let license = true;
    await setup(storeHomeDto({ status: "pending", checklist: { license: true, card: false } }), {
      "GET /api/store/home": () => ({ json: storeHomeDto({ status: "pending", checklist: { license, card: false } }) }),
      "DELETE /api/store/license": () => {
        license = false;
        return { json: { ok: true } };
      },
    });
    const form = screen.getByTestId(TID.form("license"));
    expect(form.textContent).toMatch(/承認の確かめ/);
    expect(form.textContent).toMatch(/消します/);
    expect(screen.getByTestId(TID.form("card")).textContent).toMatch(/請求しません/);
    fireEvent.click(screen.getByTestId(TID.btn("delete-license")));
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    fireEvent.click(within(await screen.findByTestId("confirm-delete-license")).getByTestId(TID.btn("confirm-delete-license")));
    await waitFor(() => expect(screen.getByTestId("license-status").textContent).not.toMatch(/登録済み/));
    expect(api.calls.filter((c) => c.method === "DELETE" && c.path === "/api/store/license")).toHaveLength(1);
    cleanup();
    api.restore();
    await setup(storeHomeDto({ status: "approved", checklist: { license: true, card: true } }), {});
    expect(screen.queryByTestId(TID.btn("delete-license"))).toBeNull();
  });

  it("13.9 card_setup_failed は「カードを登録する」の直下に出て、登録済みにならない", async () => {
    await setup(storeHomeDto({ status: "pending", checklist: { license: false, card: false } }), { "POST /api/store/card/setup": () => refusal("card_setup_failed") });
    fireEvent.click(screen.getByTestId(TID.btn("card-setup")));
    const form = screen.getByTestId(TID.form("card"));
    await waitFor(() => expect(form.querySelector(`[data-testid="${TID.msgForm}"]`)!.textContent).toMatch(/やり直/));
    expect(screen.getByTestId("card-status").textContent).not.toMatch(/登録済み/);
  });
});
