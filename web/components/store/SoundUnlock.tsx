"use client";

// 「音を鳴らす」のボタン（2026-09-25 監査の指摘 店-07）。
//
// iPhone などは、画面に一度触れるまで知らせの音を鳴らせない（components/store/beep の注）。置いたままの画面で
// 新しい客の音が鳴らないまま気づけないのを避けるため、鳴らせない間はそれを言い、押せば鳴らせる状態にして
// 試しに1回鳴らす。鳴らせる端末・音の口の無い端末では何も出さない。

import { useSyncExternalStore } from "react";
import { ARRIVALS_TEXTS } from "../../lib/domain/texts";
import { onSoundStatusChange, playNotifyBeep, soundStatus, unlockSound, type SoundStatus } from "./beep";

/** サーバーで描くときは音の口が無いので、ボタンを出さない */
const serverStatus = (): SoundStatus => "unsupported";

export const SoundUnlock = () => {
  const status = useSyncExternalStore(onSoundStatusChange, soundStatus, serverStatus);

  if (status !== "locked") return null;
  return (
    <p className="store-sound" role="status" data-testid="sound-locked">
      {ARRIVALS_TEXTS.soundLockedNote}
      <button
        type="button"
        className="store-btn store-btn--quiet"
        data-testid="btn-unlock-sound"
        onClick={() => {
          void unlockSound().then((running) => {
            if (running) playNotifyBeep();
          });
        }}
      >
        {ARRIVALS_TEXTS.unlockSound}
      </button>
    </p>
  );
};

export default SoundUnlock;
