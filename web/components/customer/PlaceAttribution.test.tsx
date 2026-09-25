// @vitest-environment jsdom
// 場所の候補と現在地の地名は Google の地図サービスから来る。地図を出さずに見せるときは、同じ入れ物の中に
// 「Google Maps」の帰属の表示を置く（2026-09-25 監査の指摘 設計-20 の案1・Geocoding API Policies の Attribution）。
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaceField } from "./PlaceField";

/** 候補は Google から来た3件（候補の入口は呼ばない） */
vi.mock("../../lib/client/placeSuggest", () => ({ usePlaceSuggestions: () => ["渋谷駅", "渋谷ヒカリエ", "渋谷区役所"] }));

const baseProps = { place: "", onPlaceChange: () => {}, locate: "idle" as const, hereLabel: null, away: false, onUseLocation: () => {}, failure: null };

afterEach(() => cleanup());

describe("Google の地図サービスの帰属の表示", () => {
  it("候補の一覧の中に「Google Maps」が出る（候補の行としては選べない）", () => {
    render(<PlaceField {...baseProps} place="渋" />);
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    const list = screen.getByTestId("place-suggestions");
    const attribution = screen.getByTestId("place-suggest-attribution");
    expect(list.contains(attribution)).toBe(true);
    expect(attribution.textContent).toBe("Google Maps");
    // 選べる行は候補の3件だけ（帰属の表示は option ではない）
    expect(screen.getAllByTestId("place-suggestion")).toHaveLength(3);
    expect(attribution.getAttribute("role")).not.toBe("option");
  });

  it("現在地を地名にできたときは、地名の案内の横に「Google Maps」が出る。地名が無いときは出さない", () => {
    render(<PlaceField {...baseProps} locate="located" hereLabel="東京都渋谷区道玄坂1丁目" />);
    const status = screen.getByTestId("locate-status");
    expect(status.textContent).toContain("東京都渋谷区道玄坂1丁目");
    expect(status.querySelector("[data-testid=google-attribution]")?.textContent).toBe("Google Maps");
    cleanup();
    render(<PlaceField {...baseProps} locate="located" hereLabel={null} />);
    expect(screen.queryByTestId("google-attribution")).toBeNull();
  });
});
