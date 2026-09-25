// @vitest-environment jsdom
// 知らせの音（2026-09-25 監査の指摘 店-07）。
//
// iOS の WebKit は、利用者の操作の外で作った AudioContext を止めたまま（suspended）にする。以前は鳴らすたびに
// 新しい AudioContext を作り、resume() も呼ばなかったので、30秒ごとの取り直しの中で鳴らす「新しい客」の音は
// iPhone では鳴らない見込みだった。今は——音の口は1つだけ持ち、最初に画面に触れたときに resume() して
// 鳴らせる状態にする。鳴らせなかったことは呼ぶ側へ返す（呼ぶ側が振動と画面の印で補う）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 偽の AudioContext。作られた数と、resume() で動き出すことだけを持つ。iOS の WebKit と同じく、
 * **利用者の操作の中で呼ばれた resume() だけが効く**（`duringGesture` が立っている間）。
 */
class FakeAudioContext {
  static created = 0;
  static duringGesture = false;
  state: "suspended" | "running" | "closed" = "suspended";
  currentTime = 0;
  destination = {};
  constructor() {
    FakeAudioContext.created += 1;
  }
  resume = vi.fn(async () => {
    if (FakeAudioContext.duringGesture) this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createOscillator = () => ({ type: "sine", frequency: { value: 0 }, connect: (next: unknown) => next, start: vi.fn(), stop: vi.fn() });
  createGain = () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 }, connect: (next: unknown) => next });
  createBuffer = () => ({});
  createBufferSource = () => ({ buffer: null, connect: vi.fn(), start: vi.fn() });
}

/** 利用者の操作の中で走らせる（その間だけ resume() が効く） */
const asGesture = <T,>(run: () => T): T => {
  FakeAudioContext.duringGesture = true;
  try {
    return run();
  } finally {
    FakeAudioContext.duringGesture = false;
  }
};

const loadBeep = async () => {
  vi.resetModules();
  return import("./beep");
};

beforeEach(() => {
  FakeAudioContext.created = 0;
  FakeAudioContext.duringGesture = false;
  Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: FakeAudioContext });
});

afterEach(() => {
  Reflect.deleteProperty(window, "AudioContext");
});

describe("知らせの音（店-07）", () => {
  it("止まった音の口では鳴らさず false を返し、画面に触れると動き出して、以後は鳴らせる（true）", async () => {
    const { playNotifyBeep, soundStatus } = await loadBeep();
    expect(playNotifyBeep()).toBe(false);
    expect(soundStatus()).toBe("locked");
    // 取り直しの中（操作の外）で何度鳴らそうとしても動き出さない
    expect(playNotifyBeep()).toBe(false);
    expect(soundStatus()).toBe("locked");
    asGesture(() => window.dispatchEvent(new Event("pointerdown")));
    await vi.waitFor(() => expect(soundStatus()).toBe("ready"));
    expect(playNotifyBeep()).toBe(true);
  });

  it("何度鳴らしても音の口は1つだけ（鳴らすたびに作らない・閉じない）", async () => {
    const { playNotifyBeep, unlockSound } = await loadBeep();
    await asGesture(() => unlockSound());
    playNotifyBeep();
    playNotifyBeep();
    playNotifyBeep();
    expect(FakeAudioContext.created).toBe(1);
  });

  it("音の口の無い端末では unsupported を返し、鳴らさない", async () => {
    Reflect.deleteProperty(window, "AudioContext");
    const { playNotifyBeep, soundStatus } = await loadBeep();
    expect(soundStatus()).toBe("unsupported");
    expect(playNotifyBeep()).toBe(false);
  });
});
