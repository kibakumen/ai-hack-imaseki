"use client";

// 運営のホーム＝店の一覧（要件24の基準 24.1〜24.9）。開いた時に一覧の入口を1回呼び、
// 返ってきた行と集計をそのまま描く（判断は入口の側・設計書「概要」の芯の1）。
// 絞り込みと検索は問い合わせ文字列で入口へ渡し、重ねて効く（基準 24.6）。

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { ADMIN_SEARCH_MAX } from "../../lib/schemas/limits";
import { FormMessage } from "../ui/InputRefusal";

type StoreStatus = "pending" | "approved" | "banned";

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  status: StoreStatus;
  publishing?: boolean;
};

type StoreListResponse = { items: StoreRow[]; summary: { publishing: number; pending: number } };

/** 絞り込みの4つと「すべて」（基準 24.3）。値は入口の語、表示は運営が読む言葉。 */
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

export const StoreList = () => {
  const [filter, setFilter] = useState("");
  /** 送ったあとの検索の語（打っている途中では取り直さない） */
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [data, setData] = useState<StoreListResponse | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

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

  return (
    <main>
      <h1>お店</h1>

      <dl data-testid="store-summary">
        <dt>オファー公開数</dt>
        <dd>{data?.summary.publishing ?? "—"}</dd>
        <dt>未承認</dt>
        <dd>{data?.summary.pending ?? "—"}</dd>
      </dl>

      <nav aria-label="絞り込み">
        {FILTERS.map((f) => (
          <button key={f.value || "all"} type="button" data-testid={`filter-${f.value || "all"}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
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

      {data && data.items.length === 0 && (
        <p data-testid="stores-empty">当てはまるお店はありません。</p>
      )}

      {data && data.items.length > 0 && (
        <ul>
          {data.items.map((store) => (
            <li key={store.id} data-testid={`row-${store.id}`}>
              <Link href={`/admin/stores/${store.id}`}>{store.name}</Link>
              <span>{store.address ?? "住所はまだありません"}</span>
              <span>{store.email ?? "メールアドレスはまだありません"}</span>
              <span>{STATUS_LABELS[store.status]}</span>
              {store.publishing && <span>オファー公開中</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default StoreList;
