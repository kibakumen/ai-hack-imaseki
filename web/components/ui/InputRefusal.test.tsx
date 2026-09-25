// @vitest-environment jsdom
// 入力の断りと欄の結びつき（2026-09-25 監査の指摘 横断-05）。
//
// それまで断りの文には id が無く、欄に aria-invalid と aria-describedby を付けている箇所が1つも無かった。
// 赤枠は「欄の直後に断りの文がある」ことを頼りにした CSS で付けていたので、div で包まれた欄（場所）と
// ダイヤル（配信数・何名まで）は、いちばんよく出る断りでも赤くならず、読み上げではどの欄の断りか結びつかなかった。
// 今は断りの文が欄の id から決まる id を持ち、欄は fieldAria でそれを指す。赤枠は [aria-invalid="true"] に付ける。

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiFailure } from "../../lib/client/api";
import { installFakeApi, invalidInput, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { ReportForm } from "../customer/ReportForm";
import { FetchForm } from "../customer/FetchForm";
import { PublishForm } from "../store/PublishForm";
import { FieldMessage, fieldAria, refusalIdOf } from "./InputRefusal";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const refusedFields = (fields: Array<{ name: string; reason: string }>, kind = "invalid_input"): ApiFailure => ({ ok: false, error: { kind, fields } }) as ApiFailure;

/** 欄が断りの文を指していて、その文が画面に在ること。 */
const expectLinked = (field: HTMLElement) => {
  expect(field.getAttribute("aria-invalid")).toBe("true");
  const ids = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const messages = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null && el.classList.contains("msg"));
  expect(messages.length, "aria-describedby が断りの文を指していない").toBe(1);
  expect(messages[0].textContent).not.toBe("");
};

describe("fieldAria と FieldMessage（横断-05）", () => {
  it("断りの文の id は欄の id から決まり、欄はその id を aria-describedby で指す", () => {
    const failure = refusedFields([{ name: "reason", reason: "required" }]);
    render(
      <>
        <textarea id="report-reason" {...fieldAria("reason", failure, "report-reason")} />
        <FieldMessage name="reason" inputId="report-reason" failure={failure} ctx={{ field: "理由" }} />
      </>,
    );
    expect(screen.getByTestId("msg-reason").id).toBe(refusalIdOf("report-reason"));
    expectLinked(document.getElementById("report-reason")!);
  });

  it("断りが無い・ほかの項目の断りなら何も付けない。欄がもともと持つ説明は残す", () => {
    expect(fieldAria("reason", null, "report-reason")).toEqual({});
    expect(fieldAria("reason", refusedFields([{ name: "other", reason: "required" }]), "report-reason")).toEqual({});
    expect(fieldAria("password", null, "pw", { describedBy: "pw-hint" })).toEqual({ "aria-describedby": "pw-hint" });
    expect(fieldAria("password", refusedFields([{ name: "password", reason: "too_short" }]), "pw", { describedBy: "pw-hint" })).toEqual({
      "aria-invalid": true,
      "aria-describedby": `pw-hint ${refusalIdOf("pw")}`,
    });
  });

  it("項目に結びつけた規則の断り（kinds）でも欄を指す", () => {
    const failure = { ok: false, error: { kind: "address_unresolved" } } as ApiFailure;
    expect(fieldAria("address", failure, "addr", { kinds: ["address_unresolved"] })).toEqual({ "aria-invalid": true, "aria-describedby": refusalIdOf("addr") });
    expect(fieldAria("address", failure, "addr")).toEqual({});
  });
});

describe("画面の欄が断りと結びつく（横断-05）", () => {
  it("通報の理由の欄", async () => {
    api = installFakeApi({ "POST /api/customer/reports": () => invalidInput([{ name: "reason", reason: "required" }]) });
    render(<ReportForm storeId="s1" storeName="テスト食堂" onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("btn-send-report"));
    await screen.findByTestId("msg-reason");
    expectLinked(screen.getByTestId("field-reason"));
  });

  it("div に包まれた場所の欄（CSS の隣の兄弟の見分けでは赤くならなかった）", async () => {
    api = installFakeApi({ "POST /api/customer/fetch": () => invalidInput([{ name: "place", reason: "too_long" }]) });
    render(<FetchForm party="2" onPartyChange={() => undefined} onResults={() => undefined} />);
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷駅" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await screen.findByTestId("msg-place");
    expectLinked(screen.getByTestId("field-place"));
  });

  it("ダイヤルの配信数と何名まで（裏の欄が断りを指し、ダイヤルの入れ物が [aria-invalid] を持つ）", async () => {
    api = installFakeApi({
      "POST /api/store/offers": () =>
        invalidInput([
          { name: "capacity", reason: "required" },
          { name: "partyMax", reason: "required" },
        ]),
    });
    render(<PublishForm coupons={[]} prefill={{ couponIds: [], capacity: null, partyMax: null, until: null }} onPublished={() => undefined} />);
    fireEvent.click(screen.getByTestId("btn-publish"));
    await screen.findByTestId("msg-capacity");
    for (const testId of ["field-capacity", "field-partyMax"]) {
      const field = screen.getByTestId(testId);
      expectLinked(field);
      expect(field.closest(".store-dial")?.querySelector('[aria-invalid="true"]')).toBe(field);
    }
  });
});

describe("項目の断りを出す部品は、どれも欄と結びつける（横断-05）", () => {
  const COMPONENTS = path.resolve(__dirname, "..");
  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(p);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [p] : [];
    });

  it("FieldMessage・FieldKindMessage に渡した inputId は、同じファイルの fieldAria にも渡っている", () => {
    const missing: string[] = [];
    for (const file of sources(COMPONENTS)) {
      const text = fs.readFileSync(file, "utf8");
      // inputId="…"・inputId={`…${…}`}・inputId={名前} のどれか（テンプレート文字列の中の } で切らない）
      const messageIds = [...text.matchAll(/<Field(?:Kind)?Message\b[^>]*?\binputId=(?:"([^"]+)"|\{(`[^`]*`|[^}]+)\})/g)].map((m) => m[1] ?? m[2]);
      const ariaIds = [...text.matchAll(/fieldAria\(\s*"[^"]+",\s*[^,]+,\s*("([^"]+)"|`[^`]*`|[A-Za-z_][\w.]*)/g)].map((m) => m[2] ?? m[1]);
      for (const id of messageIds) if (!ariaIds.includes(id)) missing.push(`${path.relative(COMPONENTS, file)}: ${id}`);
    }
    expect(missing).toEqual([]);
  });
});
