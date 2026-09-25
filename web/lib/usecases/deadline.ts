// 外の呼び出しの打ち切り（手続きが共通で使う小さな道具）。判定の写しを作らないために1か所に置く
// ——取得（usecases/fetchOffers）と紹介文（usecases/writePitch）が同じ規則で打ち切る。

/**
 * 外の呼び出しを、打ち切りの合図2つと競わせる。
 * ①実時計（`AbortSignal.timeout`——実物の呼び出しを本当に止める）②差し替えられる時計
 * （`deadline`——検査が進める）。どちらかが先に鳴れば打ち切り。例外も打ち切りと同じ扱いにする
 * （呼ぶ側の場合分けを増やさないため）。
 *
 * ⚠️ `deadline` は **この関数の外で、最初の await より前に** 作る（`http/defineRoute` の
 * `verifyHuman` と同じ）。差し替えた時計は「今」を進めたその時に待っている合図しか起こさないので、
 * 進めたあとに作った合図はもう鳴らない。
 *
 * `cancel`（任意）は3つ目の打ち切りの合図——客が画面を閉じた、のような**時間ではない**理由で止めるときに渡す
 * （usecases/streamOffers → writePitch・2026-09-25 監査の指摘 設計-18）。鳴れば、実物の呼び出しも止める。
 */
export const raceDeadline = async <T>(
  timeoutMs: number,
  deadline: Promise<void>,
  run: (signal: AbortSignal) => Promise<T>,
  cancel?: AbortSignal,
): Promise<{ ok: true; value: T } | { ok: false }> => {
  const controller = new AbortController();
  const realTimeout = AbortSignal.timeout(timeoutMs);
  const giveUp = new Promise<{ ok: false }>((resolve) => {
    const stop = (): void => {
      controller.abort();
      resolve({ ok: false });
    };
    if (realTimeout.aborted || cancel?.aborted) stop();
    else {
      realTimeout.addEventListener("abort", stop, { once: true });
      cancel?.addEventListener("abort", stop, { once: true });
    }
    void deadline.then(stop);
  });
  const work = run(controller.signal).then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  );
  return Promise.race([work, giveUp]);
};
