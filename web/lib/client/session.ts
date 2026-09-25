// 「ログインが切れた」の知らせ（2026-09-25 監査の指摘 横断-01）。
//
// client/api が 401・unauthenticated を受けるたびに知らせ、店と運営の画面の殻
// （app/store/layout・app/admin/layout の SessionExpiredNotice）が聞いて「ログインが切れました」と
// /login への道を出す。画面ごとに 401 を場合分けしなくても、どの読み込み・操作で切れても同じ所に出る。
//
// 客の画面は聞かない（客にはログインが無く、401 は「登録が消えた」の意味——CustomerApp が登録の入力へ倒す）。

type Listener = () => void;

const listeners = new Set<Listener>();

/** 切れた知らせを聞く。戻り値を呼ぶと聞くのをやめる（部品が消えるときに呼ぶ）。 */
export const onSessionExpired = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 切れたことを知らせる（client/api だけが呼ぶ）。 */
export const notifySessionExpired = (): void => {
  for (const listener of [...listeners]) listener();
};
