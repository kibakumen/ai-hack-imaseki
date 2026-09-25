// ホーム画面に追加したアプリとして開いているか・iPhone のブラウザか（2026-09-25 監査の指摘 客-04）。
//
// iPhone の Safari は、ホーム画面に追加して開いたときだけ通知（要件22）を受け取れる。追加した側は Safari と
// Cookie を共有しないので、Safari で取った今の確保は追加した側に出ない——案内の出し分けにこの2つを使う。
// 読めない環境（描画の前・古いブラウザ）では「iPhone ではない」「ホーム画面ではない」として扱う。

/** iPhone・iPad のブラウザか（iPadOS の Safari は Mac と名乗るので、指で触れるかで見分ける） */
export const isIosBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return navigator.userAgent.includes("Macintosh") && (navigator.maxTouchPoints ?? 0) > 1;
};

/** ホーム画面に追加したアプリとして開いているか */
export const isStandalone = (): boolean => {
  if (typeof window === "undefined") return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia?.("(display-mode: standalone)").matches === true;
};
