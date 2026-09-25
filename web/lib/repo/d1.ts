// D1 の型（使う分だけ）と、repo が共有する道具のただ1つの置き場
// （監査の指摘 設計-14・2026-09-25）。
//
// それまで `Deps.db` は any で、`.first()` と `.all()` の取り違えも、返った行の読み違いも
// 型検査で1つも捕まらなかった。R2 の側（adapters/files の PermitBucket）と同じく、
// **呼んでいる分だけ**を書く——Cloudflare の型の束（@cloudflare/workers-types）を丸ごと
// 読み込むと、画面の側の型まで Worker の型に引きずられるため。
//
// 道具の2つ（JSON の文字列の並びを読む・変わった行を数える）は、repo の7か所と2か所に同じ中身が
// 写されていた。判定がずれる前に、ここへ1つずつ寄せた。

/** 行1つ。列の名前 → 値。列ごとの型は、読む側の repo が決める（ここでは知らない）。 */
export type D1Row = Record<string, unknown>;

/** 書き込み・読み出しの付帯情報のうち、使う分だけ。 */
export type D1Meta = {
  /** 変わった行の数。**数が分からないことがある**ので、直接読まず `changedRows` を通す。 */
  changes?: number;
  last_row_id?: number;
  [key: string]: unknown;
};

export type D1Result<T = D1Row> = { results: T[]; success: boolean; meta: D1Meta };

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  /** 最初の1行。無ければ null。 */
  first<T = D1Row>(): Promise<T | null>;
  all<T = D1Row>(): Promise<D1Result<T>>;
  run<T = D1Row>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** 渡した文を1つのまとまりとして流す（途中で落ちたら全部戻る）。 */
  batch<T = D1Row>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<unknown>;
}

/**
 * 列に JSON の文字列で入っている並びを、要素の形を見ずに読む（要素の形は呼ぶ側が確かめる）。
 * 壊れた JSON・並びでないもの・文字列でない値は空。`parseStringList` もこれを通る。
 */
export const parseJsonArray = (raw: unknown): unknown[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * 列に JSON の文字列で入っている並び（ジャンル・おすすめメニュー・クーポンの番号など）を読む。
 * 壊れた JSON・並びでないもの・文字列でない値は**空として読む**（表示と取得を止めない・要件29）。
 * 文字列でない要素は落とす。
 */
export const parseStringList = (raw: unknown): string[] => parseJsonArray(raw).filter((value): value is string => typeof value === "string");

/**
 * 書き込みで変わった行の数。**数が分からないときは 0**（＝変わっていない）へ倒す。
 *
 * 呼ぶ側は「前の状態を WHERE に入れた1つの UPDATE」が当たったかをこれで見る。分からないときに
 * 「当たった」側へ倒すと、同時に来た操作に負けたのに通したことになる——判定は断る側の1つだけにする
 * （監査の指摘 設計-13: 承認・停止・戻すの3本だけが逆向きに倒していた）。
 */
export const changedRows = (result: D1Result<unknown> | null | undefined): number => {
  const changes = result?.meta?.changes;
  return typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
};
