// 運営の店の一覧の条件（絞り込み・ジャンル・検索・並び順）を URL の問い合わせ文字列に載せる道具
// （2026-09-25 監査の指摘 運営-06）。一覧→詳細→一覧と移っても、条件を失わないようにする。
// 値の正しさは見ない（知らない値は一覧の入口が断る・並び順は画面が既定へ倒す）。載せる鍵を揃えるだけ。

export const LIST_QUERY_KEYS = ["filter", "genre", "q", "sort"] as const;

export type ListQueryKey = (typeof LIST_QUERY_KEYS)[number];
export type ListQuery = Partial<Record<ListQueryKey, string>>;

/** Next.js の searchParams（同じ鍵が複数あれば配列）から、一覧の条件だけを拾う。 */
export const pickListQuery = (params: Record<string, string | string[] | undefined>): ListQuery =>
  Object.fromEntries(
    LIST_QUERY_KEYS.flatMap((key) => {
      const raw = params[key];
      const value = Array.isArray(raw) ? raw[0] : raw;
      return value ? [[key, value]] : [];
    }),
  );

/** 条件を問い合わせ文字列にする（空の値は載せない・鍵の順は決まった順）。 */
export const toListQueryString = (query: ListQuery): string => {
  const search = new URLSearchParams();
  for (const key of LIST_QUERY_KEYS) {
    const value = query[key];
    if (value) search.set(key, value);
  }
  return search.toString();
};
