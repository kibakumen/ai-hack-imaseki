"use client";

// 運営のホーム＝店の一覧（要件24の基準 24.1〜24.9）。開いた時に一覧の入口を1回呼び、
// 返ってきた行と集計をそのまま描く（判断は入口の側・設計書「概要」の芯の1）。
// 絞り込みと検索は問い合わせ文字列で入口へ渡し、重ねて効く（基準 24.6）。
//
// 2026-09-22 速成版（sprint/app/admin）の磨き込みを移植（本人選択）:
//   - フィルターの「公開中」は「オファー公開中」と名乗る（元から一致・変更なし）
//   - 未承認をもっと強調する大見出し＋「未承認だけ見る」ボタン（押すと一覧までスクロール）
//   - 並び替え。既定は「登録が新しい順」。一覧の応答は登録した順（古い順）で返るので、その逆順で出す
//     （`lib/repo/adminStores.ts` のコメント「並びは登録した順」に依拠）。
//   - カードのデザイン（状態バッジ・件数タイル）
//
// 2026-09-22 並び替えの残り3つを有効化（本人指摘）: 一覧の入口（`lib/repo/adminStores.ts`）に
// 受け取り実績・予算の下限・公開中のオファーの残り枠を足したので、選べるだけでなく実際に並ぶ。
// 並べ替え自体はこの画面（クライアント側）で行う——問い合わせ文字列に `sort` は無い。
// 予算未設定・オファー無しの店（値が null）は compareNullsLast で末尾へ回す。

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { ADMIN_SEARCH_MAX } from "../../lib/schemas/limits";
import { FormMessage } from "../ui/InputRefusal";
import styles from "./admin.module.css";

type StoreStatus = "pending" | "approved" | "banned";

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  status: StoreStatus;
  publishing?: boolean;
  /** 受け取り実績＝完了済みの確保の数（並び替え「受け取り実績が多い順」）。応答に無ければ0扱い。 */
  claims?: number;
  /** 予算の下限。未設定の店は null（並び替え「予算が安い順」）。 */
  budgetMin?: number | null;
  /** 公開中のオファーの残り枠。無ければ null（並び替え「残り枠が多い順」）。 */
  offerRemaining?: number | null;
};

type StoreListResponse = { items: StoreRow[]; summary: { publishing: number; pending: number } };

/** 絞り込みの4つと「すべて」（基準 24.3）。値は入口の語、表示は運営が読む言葉。既定は「すべて」。 */
const FILTERS = [
  { value: "", label: "すべて" },
  { value: "publishing", label: "オファー公開中" },
  { value: "approved", label: "承認済み" },
  { value: "pending", label: "未承認" },
  { value: "banned", label: "止められている" },
] as const;

const STATUS_LABELS: Record<StoreStatus, string> = {
  pending: "未承認",
  approved: "承認済み",
  banned: "止められている",
};

type SortKey = "created_desc" | "claims_desc" | "price_asc" | "remaining_desc";

const SORT_OPTIONS: { key: SortKey; label: string; available: boolean }[] = [
  { key: "created_desc", label: "登録が新しい順", available: true },
  { key: "claims_desc", label: "受け取り実績が多い順", available: true },
  { key: "price_asc", label: "予算が安い順", available: true },
  { key: "remaining_desc", label: "残り枠が多い順", available: true },
];

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
      return [...items].sort((a, b) => compareNullsLast(a.claims ?? 0, b.claims ?? 0, "desc"));
    case "price_asc":
      return [...items].sort((a, b) => compareNullsLast(a.budgetMin, b.budgetMin, "asc"));
    case "remaining_desc":
      return [...items].sort((a, b) => compareNullsLast(a.offerRemaining, b.offerRemaining, "desc"));
  }
};

export const StoreList = () => {
  const [filter, setFilter] = useState("");
  /** 送ったあとの検索の語（打っている途中では取り直さない） */
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_desc");
  const [data, setData] = useState<StoreListResponse | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async (): Promise<{ data: StoreListResponse | null; failure: ApiFailure | null }> => {
    const params = new URLSearchParams();
    if (filter) params.set("filter", filter);
    if (query) params.set("q", query);
    const suffix = params.toString();
    const result = await apiCall<StoreListResponse>("GET", `/api/admin/stores${suffix ? `?${suffix}` : ""}`);
    return isFailure(result) ? { data: null, failure: result } : { data: result, failure: null };
  }, [filter, query]);

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
  const pending = data?.summary.pending ?? 0;

  return (
    <main className={styles.page}>
      <h1>お店</h1>

      <nav className={styles.topNav} aria-label="運営の画面">
        <Link href="/admin/reports">通報</Link>
        <Link href="/admin/metrics">数字</Link>
      </nav>

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
          <dt className={styles.tileLabel}>表示中</dt>
          <dd className={styles.tileValue}>{data ? items.length : "—"}</dd>
        </div>
      </dl>

      {data && (
        <section className={pending > 0 ? styles.pendingBanner : `${styles.pendingBanner} ${styles.calm}`}>
          {pending > 0 ? (
            <>
              <div>
                <p>承認待ち</p>
                <p className={styles.pendingCount}>{pending}件</p>
              </div>
              <button type="button" onClick={showPendingOnly}>
                未承認だけ見る
              </button>
            </>
          ) : (
            <p>承認待ちはありません</p>
          )}
        </section>
      )}

      <nav className={styles.filters} aria-label="絞り込み">
        {FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            data-testid={`filter-${f.value || "all"}`}
            aria-pressed={filter === f.value}
            className={styles.filterBtn}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
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
        <select id="admin-store-sort" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key} disabled={!o.available}>
              {o.label}
              {o.available ? "" : "（準備中）"}
            </option>
          ))}
        </select>
        {data && <span className={styles.count}>{items.length}件表示 / 全{data.items.length}件</span>}
      </div>

      {data && data.items.length === 0 && (
        <p data-testid="stores-empty">当てはまるお店はありません。</p>
      )}

      {data && data.items.length > 0 && (
        <ul ref={listRef} className={styles.cardList}>
          {items.map((store) => (
            <li key={store.id} data-testid={`row-${store.id}`} className={styles.card}>
              <div className={styles.cardHead}>
                <Link href={`/admin/stores/${store.id}`}>{store.name}</Link>
                <span className={styles.badge} data-status={store.status}>{STATUS_LABELS[store.status]}</span>
                {store.publishing && (
                  <span className={styles.badge} data-status="publishing">オファー公開中</span>
                )}
              </div>
              <span className={styles.cardMeta}>{store.address ?? "住所はまだありません"}</span>
              <span className={styles.cardMeta}>{store.email ?? "メールアドレスはまだありません"}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default StoreList;
