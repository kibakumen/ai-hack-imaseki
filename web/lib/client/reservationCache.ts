// 確保中の表示の内容を端末に残す（要件9の基準 9.10〜9.12。設計書「電波が切れたとき」）。
//
// 取り直しが**成功するたびに**上書きし、取り直しが**通信の失敗**に終わったときだけ、残した内容と
// 「最新の状態を確かめられていません」を出す（見分けの断り＝401 とは分ける。401 は登録の入力へ倒す）。
// 店頭での照合の正は店の一覧の側にあるので、客の側は最後に取れたコード・店名・人数が出せれば足りる。
//
// 残せないこと（プライベートモード・容量いっぱい）で画面を止めない——読めなければ「無い」として扱い、
// 書けなければ黙って諦める。残せるかどうかは表示の正しさに関わらない。
//
// ⚠️ タスク32（登録の消去）はここの `clearHome` を呼ぶ（基準 28.9）。

const KEY = "ai-sekitori:customer-home";

/** localStorage が使える場面だけ触る（サーバー側の描画では触らない）。 */
const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const saveHome = (home: unknown): void => {
  try {
    storage()?.setItem(KEY, JSON.stringify(home));
  } catch {
    // 残せないだけ。表示は続ける
  }
};

export const loadHome = <T>(): T | null => {
  try {
    const raw = storage()?.getItem(KEY);
    return raw === null || raw === undefined ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
};

export const clearHome = (): void => {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // 消せないだけ
  }
};
