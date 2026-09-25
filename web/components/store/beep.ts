// 客が受け取ったとき・完了にしたときの知らせの音（2026-09-21 の本人の指摘「気づけるように音と
// 動きが欲しい」）。速成版 `sprint/app/store/_lib/beep.ts` を移したもの。
//
// 音のファイルは足さない——Web Audio の発振器で2音だけ鳴らす（「ぴろん」と上がる2音）。
//
// 2026-09-25 監査の指摘 店-07: 以前は鳴らすたびに AudioContext を作って閉じ、resume() も呼ばなかった。
// iOS の WebKit は利用者の操作の外で作った AudioContext を止めたまま（suspended）にするので、30秒ごとの
// 取り直しの中で鳴らす「新しい客」の音は iPhone では鳴らない見込みだった（確度: 推測。実機で確かめる）。
// 今は——
//   - 音の口（AudioContext）は**ページに1つだけ**持ち、閉じない
//   - **最初に画面に触れたとき**（pointerdown・keydown・touchend）に resume() し、無音を1回鳴らして鳴らせる状態にする
//   - 鳴らせなかったときは false を返す（呼ぶ側が振動と画面の印で補う。黙って成功したことにしない）
//   - 鳴らせる状態かどうかは `soundStatus()` と `onSoundStatusChange()` で画面へ出せる（「音を鳴らす」のボタン）
// 客の確定の演出（components/customer/ClaimedCelebration）も同じ口を使うので、客が「この店に行く」を押した
// 操作で音の口が動き出す。

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

/** 鳴らせるか。ready＝鳴らせる、locked＝画面に触れるまで鳴らせない、unsupported＝音の口の無い端末 */
export type SoundStatus = "ready" | "locked" | "unsupported";

/** ラ → 高いミ。上向きに聞こえる2音 */
const NOTES_HZ = [880, 1175];
const NOTE_GAP_S = 0.09;
const NOTE_LEN_S = 0.18;
const PEAK_GAIN = 0.25;
/** 0 にすると exponentialRamp が使えないので、聞こえない程度の小さな値を下端にする */
const SILENT_GAIN = 0.0001;
/** 立ち上がりと、止めるまでの余白（切れ際のプツッを避ける） */
const ATTACK_S = 0.01;
const RELEASE_S = 0.02;
/** 無音の1回ぶんの長さ（標本1つ）と標本化の速さ */
const SILENT_SAMPLE_RATE = 22_050;
/** 音の口を動かす操作（最初の1回で足りる。動き出したら外す） */
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

let shared: AudioContext | null = null;
let unsupported = false;
const listeners = new Set<() => void>();

const audioCtor = (): typeof AudioContext | null => {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext ?? null;
};

/** ページに1つの音の口。作れなければ null（以後は作ろうとしない）。 */
const context = (): AudioContext | null => {
  if (shared || unsupported) return shared;
  const Ctor = audioCtor();
  if (!Ctor) {
    unsupported = true;
    return null;
  }
  try {
    shared = new Ctor();
  } catch {
    unsupported = true;
    return null;
  }
  return shared;
};

const notify = () => {
  for (const listener of listeners) listener();
};

/** 鳴らせるか。音の口はまだ作らない（描く途中で読んでよい）。 */
export const soundStatus = (): SoundStatus => {
  if (unsupported || audioCtor() === null) return "unsupported";
  return shared?.state === "running" ? "ready" : "locked";
};

/** 鳴らせるかどうかが変わったら呼ぶ。戻り値で外す。 */
export const onSoundStatusChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** iOS は resume() だけでは足りないことがあるので、操作の中で無音を1回鳴らす。 */
const playSilence = (ctx: AudioContext) => {
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, SILENT_SAMPLE_RATE);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // 無音が鳴らせなくても resume() は試す
  }
};

/**
 * 音の口を動かす。**利用者の操作の中で呼ぶ**（画面に触れた・「音を鳴らす」を押した）。
 * 動いたら true。
 */
export const unlockSound = async (): Promise<boolean> => {
  const ctx = context();
  if (!ctx) return false;
  playSilence(ctx);
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      // 動かせなかった（次の操作でまた試す）
    }
  }
  notify();
  return ctx.state === "running";
};

function removeUnlockListeners() {
  for (const type of UNLOCK_EVENTS) window.removeEventListener(type, onFirstGesture, true);
}

function onFirstGesture() {
  void unlockSound().then((running) => {
    if (running) removeUnlockListeners();
  });
}

// 最初に画面に触れたときに音の口を動かす（読み込んだ時点で1回だけ仕掛ける）。音の口の無い端末では仕掛けない。
if (audioCtor() !== null) {
  for (const type of UNLOCK_EVENTS) window.addEventListener(type, onFirstGesture, { capture: true, passive: true });
}

const scheduleNotes = (ctx: AudioContext) => {
  NOTES_HZ.forEach((freq, index) => {
    const startAt = ctx.currentTime + index * NOTE_GAP_S;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(SILENT_GAIN, startAt);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, startAt + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, startAt + NOTE_LEN_S);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + NOTE_LEN_S + RELEASE_S);
  });
};

/**
 * 知らせの2音を鳴らす。鳴らせた（音の口が動いている）なら true、鳴らせなかったなら false。
 * ⚠️ 鳴らせない場面でも例外にはしない——音は知らせの飾りで、操作の結果そのものは画面に出る。
 */
export const playNotifyBeep = (): boolean => {
  const ctx = context();
  if (!ctx) return false;
  if (ctx.state !== "running") {
    // 操作の中から呼ばれた場合（完了を押した・客が受け取った）は、ここで動き出すことがある。次の回から鳴る。
    void ctx.resume().then(notify, () => undefined);
    return false;
  }
  try {
    scheduleNotes(ctx);
    return true;
  } catch {
    return false;
  }
};
