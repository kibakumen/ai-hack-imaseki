"use client";

// 運営のホーム＝店の一覧（要件24の基準 24.1〜24.9）。開いた時に一覧の入口を1回呼び、
// 返ってきた行と集計をそのまま描く（判断は入口の側・設計書「概要」の芯の1）。
// 絞り込み・ジャンル・検索は問い合わせ文字列で入口へ渡し、重ねて効く（基準 24.6）。
//
// 2026-09-22 速成版（sprint/app/admin）の磨き込みを移植（本人選択）:
//   - 未承認をもっと強調する大見出し＋「未承認だけ見る」ボタン（押すと一覧までスクロール）
//   - 並び替え。既定は「登録が新しい順」。一覧の応答は登録した順（古い順）で返るので、その逆順で出す
//   - カードのデザイン（状態バッジ・件数タイル）
// 並べ替え自体はこの画面（クライアント側）で行う——入口の問い合わせ文字列に `sort` は無い。
// 予算未設定・オファー無しの店（値が null）は compareNullsLast で末尾へ回す。
//
// 2026-09-25 監査の指摘で直した:
//   - 絞り込み・ジャンル・検索・並び順を URL の問い合わせ文字列に載せ、詳細へのリンクへ引き継ぐ（運営-06）
//   - ジャンルで絞れる（運営-07）
//   - カードに並びの元の数の札（運営-10）→ StoreCard
//   - 「全N件」は絞り込みに左右されない全店の数。一覧の中の重複したナビを消した（運営-11）
//   - 承認待ちの強調は「連絡済み」を除いた数（運営-05）

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { callApi, isFailure, type AdminStoreRowDto, type ApiFailure, type ResponseOf } from "../../lib/client/api";
import { TEXTS } from "../../lib/domain/texts";
import { ADMIN_SEARCH_MAX } from "../../lib/schemas/limits";
import { FormMessage } from "../ui/InputRefusal";
import { toListQueryString, type ListQuery } from "./listQuery";
import { StoreCard, type SortKey } from "./StoreCard";
import styles from "./admin.module.css";

// 応答の型は、サーバーと同じ定義（schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
type StoreRow = AdminStoreRowDto;
type StoreListResponse = ResponseOf<"GET /api/admin/stores">;

/** 絞り込みの4つと「すべて」（基準 24.3）。値は入口の語、表示は運営が読む言葉。既定は「すべて」。 */
const FILTERS = [
  { value: "", label: "すべて" },
  { value: "publishing", label: "オファー公開中" },
  { value: "approved", label: "承認済み" },
  { value: "pending", label: "未承認" },
  { value: "banned", label: "止められている" },
] as const;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "created_desc", label: "登録が新しい順" },
  { key: "claims_desc", label: "受け取り実績が多い順" },
  { key: "price_asc", label: "予算が安い順" },
  { key: "remaining_desc", label: "残り枠が多い順" },
];

const DEFAULT_SORT: SortKey = "created_desc";

/** URL から来た並び順。知らない値は既定へ倒す。 */
const toSortKey = (value: string | undefined): SortKey => SORT_OPTIONS.find((o) => o.key === value)?.key ?? DEFAULT_SORT;

/**
 * null は常に末尾へ回す（予算未設定・公開中のオファー無し）。`direction` は null 以外どうしの比べ方
 * （"asc"=小さい順・"desc"=大きい順）。
 */
const compareNullsLast = (a: number | null | undefined, b: number | null | undefined, direction: "asc" | "desc"): number => {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return direction === "asc" ? av - bv : bv - av;
};

/** 一覧の応答は登録した順（古い順）。「新しい順」はその逆順にするだけで並べられる（他の3つは値で並べる）。 */
const sortItems = (items: StoreRow[], key: SortKey): StoreRow[] => {
  switch (key) {
    case "created_desc":
      return [...items].reverse();
    case "claims_desc":
      return [...items].sort((a, b) => compareNullsLast(a.claims, b.claims, "desc"));
    case "price_asc":
      return [...items].sort((a, b) => compareNullsLast(a.budgetMin, b.budgetMin, "asc"));
    case "remaining_desc":
      return [...items].sort((a, b) => compareNullsLast(a.offerRemaining, b.offerRemaining, "desc"));
  }
};

/** 並び順は既定なら URL に載せない（何も選んでいない一覧の URL を `/admin` のままにする）。 */
const listQueryOf = (query: { filter: string; genre: string; q: string; sort: SortKey }): string =>
  toListQueryString({ filter: query.filter, genre: query.genre, q: query.q, sort: query.sort === DEFAULT_SORT ? "" : query.sort });

/** 今の条件を URL へ書く（履歴は増やさない）。一覧→詳細→戻る で条件が残る（運営-06）。 */
const useSyncListQueryToUrl = (listQuery: string) => {
  useEffect(() => {
    const next = `${window.location.pathname}${listQuery ? `?${listQuery}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(window.history.state, "", next);
  }, [listQuery]);
};

type Props = { initialQuery?: ListQuery };

export const StoreList = ({ initialQuery = {} }: Props) => {
  const [filter, setFilter] = useState(initialQuery.filter ?? "");
  const [genre, setGenre] = useState(initialQuery.genre ?? "");
  /** 送ったあとの検索の語（打っている途中では取り直さない） */
  const [query, setQuery] = useState(initialQuery.q ?? "");
  const [input, setInput] = useState(initialQuery.q ?? "");
  const [sortKey, setSortKey] = useState<SortKey>(toSortKey(initialQuery.sort));
  const [data, setData] = useState<StoreListResponse | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const listQuery = listQueryOf({ filter, genre, q: query, sort: sortKey });
  useSyncListQueryToUrl(listQuery);

  const load = useCallback(async (): Promise<{ data: StoreListResponse | null; failure: ApiFailure | null }> => {
    // 空の値は送らない（callApi が落とす）——「指定なし」と「空の指定」を入口で分けないため。
    const result = await callApi("GET /api/admin/stores", { query: { filter, genre, q: query } });
    return isFailure(result) ? { data: null, failure: result } : { data: result, failure: null };
  }, [filter, genre, query]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await load();
      if (!alive) return;
      setData(next.data);
      setFailure(next.failure);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(input);
  };

  /** 未承認だけ見る（強調バナーのボタン）。絞り込みを切り替えて、一覧の位置までスクロールする。 */
  const showPendingOnly = () => {
    setFilter("pending");
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const items = data ? sortItems(data.items, sortKey) : [];
  const awaiting = data?.summary.awaiting ?? 0;
  const contacted = data ? data.summary.pending - data.summary.awaiting : 0;
  const detailHref = (id: string) => `/admin/stores/${id}${listQuery ? `?${listQuery}` : ""}`;

  return (
    <main className={styles.page}>
      <h1>お店</h1>

      <dl data-testid="store-summary" className={styles.summaryTiles}>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>オファー公開数</dt>
          <dd className={styles.tileValue}>{data?.summary.publishing ?? "—"}</dd>
        </div>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>未承認</dt>
          <dd className={styles.tileValue}>{data?.summary.pending ?? "—"}</dd>
        </div>
        <div className={styles.tile}>
          <dt className={styles.tileLabel}>登録されている店</dt>
          <dd className={styles.tileValue}>{data?.summary.total ?? "—"}</dd>
        </div>
      </dl>

      {data && (
        <section data-testid="pending-banner" className={awaiting > 0 ? styles.pendingBanner : `${styles.pendingBanner} ${styles.calm}`}>
          {awaiting > 0 ? (
            <>
              <div>
                <p>承認待ち</p>
                <p className={styles.pendingCount}>{awaiting}件</p>
                {contacted > 0 && <p className={styles.count}>{`（連絡済み ${contacted} 件は除いています）`}</p>}
              </div>
              <button type="button" onClick={showPendingOnly}>
                未承認だけ見る
              </button>
            </>
          ) : (
            <p>{contacted > 0 ? `承認待ちはありません（連絡済み ${contacted} 件）` : "承認待ちはありません"}</p>
          )}
        </section>
      )}

      <nav className={styles.filters} aria-label="絞り込み">
        {FILTERS.map((f) => (
          <button key={f.value || "all"} type="button" data-testid={`filter-${f.value || "all"}`} aria-pressed={filter === f.value} className={styles.filterBtn} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </nav>

      <nav className={styles.filters} aria-label="ジャンルで絞る">
        {["", ...TEXTS.genres].map((g) => (
          <button key={g || "all"} type="button" data-testid={`genre-${g || "all"}`} aria-pressed={genre === g} className={styles.filterBtn} onClick={() => setGenre(g)}>
            {g || "すべてのジャンル"}
          </button>
        ))}
      </nav>

      <form data-testid="form-search" noValidate onSubmit={search}>
        <label htmlFor="admin-store-search">店名・住所・メールアドレスで探す</label>
        <input id="admin-store-search" data-testid="field-q" type="search" value={input} maxLength={ADMIN_SEARCH_MAX} onChange={(event) => setInput(event.target.value)} />
        <button type="submit" data-testid="btn-search">
          探す
        </button>
        <FormMessage failure={failure} />
      </form>

      <div className={styles.toolbar}>
        <label htmlFor="admin-store-sort">並び替え</label>
        <select id="admin-store-sort" value={sortKey} onChange={(event) => setSortKey(toSortKey(event.target.value))}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        {data && <span data-testid="list-count" className={styles.count}>{`${items.length}件表示 / 全${data.summary.total}件`}</span>}
      </div>

      {data && data.items.length === 0 && <p data-testid="stores-empty">当てはまるお店はありません。</p>}

      {data && data.items.length > 0 && (
        <ul ref={listRef} className={styles.cardList}>
          {items.map((store) => (
            <StoreCard key={store.id} store={store} sortKey={sortKey} href={detailHref(store.id)} />
          ))}
        </ul>
      )}
    </main>
  );
};

export default StoreList;
