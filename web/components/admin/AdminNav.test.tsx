// @vitest-environment jsdom
// 運営の画面の殻のナビ（2026-09-25 監査の指摘 運営-11）。今どの画面にいるかの印が無かった。
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

import { AdminNav } from "./AdminNav";

afterEach(() => cleanup());

const current = () => screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);

describe("運営の画面のナビ", () => {
  it("今いる画面のリンクにだけ aria-current が付く", () => {
    pathname.value = "/admin/reports";
    render(<AdminNav />);
    expect(current()).toEqual(["通報"]);
  });

  it("店の詳細は「店の一覧」の中として印を付ける", () => {
    pathname.value = "/admin/stores/s1";
    render(<AdminNav />);
    expect(current()).toEqual(["店の一覧"]);
  });

  it("ルータの文脈が無い（パスが分からない）ときは、どれにも印を付けない", () => {
    pathname.value = null as unknown as string;
    render(<AdminNav />);
    expect(current()).toEqual([]);
  });
});
