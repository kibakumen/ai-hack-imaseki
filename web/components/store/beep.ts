// 客が受け取ったとき・完了にしたときの知らせの音（2026-09-21 の本人の指摘「気づけるように音と
// 動きが欲しい」）。速成版 `sprint/app/store/_lib/beep.ts` をそのまま移した。
//
// 音のファイルは足さない——Web Audio の発振器で2音だけ鳴らす（「ぴろん」と上がる2音）。
// ⚠️ 鳴らせない場面（自動再生が止められている・音の口を持たない環境）では**黙って何もしない**。
//    音は知らせの飾りで、操作の結果そのものは画面に出るので、ここで手を止めない。

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

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
/** 音が鳴り終わってから音の口を閉じるまでの余白 */
const CLOSE_MARGIN_MS = 100;

export const playNotifyBeep = (): void => {
  if (typeof window === "undefined") return;
  const AudioCtx = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
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
    setTimeout(() => void ctx.close(), (NOTES_HZ.length * NOTE_GAP_S + NOTE_LEN_S) * 1000 + CLOSE_MARGIN_MS);
  } catch {
    // 鳴らせない環境は無視する（操作は続く）
  }
};
