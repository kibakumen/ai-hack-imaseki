// @vitest-environment jsdom
// 声で条件を入れる（2026-09-25 監査の指摘 客-16 の案A・本人の第1回の指摘「歩きながら音声で入れたい」）。
//
// 見るのは4つ:
//   1. 声で聞けるブラウザでは、取得の画面の先頭に「声で入れる」が在り、押すまで聞かない
//   2. 聞き取った文から人数・予算の上限・ジャンルを読んで欄へ入れる（探すのは客が押したとき）
//   3. 読み取れなかったときは欄を変えずに、その旨を出す
//   4. 声で聞けないブラウザでは部品ごと出さない

import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchForm } from "./FetchForm";

vi.mock("../../lib/client/geolocation", () => ({
  currentLocation: async () => ({ ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } }),
}));

type Handlers = { onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null; onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null };
type SpeechWindow = Window & { webkitSpeechRecognition?: unknown };

/** 音声認識の偽物。start の回数を数え、`say` で聞き取った文を返す。 */
const installSpeech = () => {
  const state = { starts: 0, current: null as Handlers | null };
  class FakeRecognition implements Handlers {
    lang = "";
    interimResults = true;
    maxAlternatives = 5;
    continuous = true;
    onresult: Handlers["onresult"] = null;
    onerror: Handlers["onerror"] = null;
    onend: Handlers["onend"] = null;
    start() {
      state.starts += 1;
      state.current = this;
    }
    abort() {}
  }
  (window as SpeechWindow).webkitSpeechRecognition = FakeRecognition;
  const say = (text: string) => act(() => state.current!.onresult!({ results: [[{ transcript: text }]] }));
  return { state, say };
};

describe("声で条件を入れる", () => {
  afterEach(() => {
    cleanup();
    delete (window as SpeechWindow).webkitSpeechRecognition;
  });

  const renderForm = (onPartyChange = vi.fn()) =>
    render(<FetchForm profile={{ nickname: "guest-a", phone: "0000000000", genres: ["和食"], budgetMax: null }} party="1" onPartyChange={onPartyChange} onResults={vi.fn()} />);

  it("先頭に「声で入れる」が在り、押すまで聞かない。聞き取った文から人数・予算・ジャンルを欄へ入れ、探しはしない", () => {
    const speech = installSpeech();
    const onPartyChange = vi.fn();
    const onResults = vi.fn();
    render(<FetchForm profile={{ nickname: "guest-a", phone: "0000000000", genres: ["和食"], budgetMax: null }} party="1" onPartyChange={onPartyChange} onResults={onResults} />);
    const button = screen.getByTestId("btn-voice");
    // 先頭（場所の欄より前）
    expect(button.compareDocumentPosition(screen.getByTestId("field-place")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(speech.state.starts).toBe(0);

    fireEvent.click(button);
    expect(speech.state.starts).toBe(1);
    speech.say("4人で居酒屋、予算3000円");

    expect(onPartyChange).toHaveBeenCalledWith("4");
    expect((within(screen.getByTestId("field-budgetMax")).getByTestId("budget-3000") as HTMLInputElement).checked).toBe(true);
    const genres = screen.getByTestId("field-genres");
    expect((within(genres).getByTestId("genre-居酒屋") as HTMLInputElement).checked).toBe(true);
    expect((within(genres).getByTestId("genre-和食") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("voice-status").textContent).toMatch(/4名・〜3,000円・居酒屋/);
    expect(onResults).not.toHaveBeenCalled();
  });

  it("読み取れなかったときは欄を変えずに、その旨を出す", () => {
    const speech = installSpeech();
    const onPartyChange = vi.fn();
    renderForm(onPartyChange);
    fireEvent.click(screen.getByTestId("btn-voice"));
    speech.say("こんにちは");
    expect(onPartyChange).not.toHaveBeenCalled();
    expect((within(screen.getByTestId("field-genres")).getByTestId("genre-和食") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("voice-status").textContent).toMatch(/読み取れませんでした/);
  });

  it("声で聞けないブラウザでは、部品ごと出さない", () => {
    renderForm();
    expect(screen.queryByTestId("btn-voice")).toBeNull();
  });
});
