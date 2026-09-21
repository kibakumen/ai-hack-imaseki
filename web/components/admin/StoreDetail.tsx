"use client";

// 運営の店の詳細（要件24の基準 24.10・24.11／要件25の基準 25.2・25.3・25.5）。
// 開いた時に詳細の入口を1回呼び、返ってきた中身を描く。承認を断る操作は置かない（基準 25.3）。
// 止めるときは、何が起きるかを見せて確かめを取ってから入口を呼ぶ（基準 25.5）。
//
// 2026-09-21 タスク21 が「承認済みに戻す」（基準 25.9・25.10）を、「止める」と同じ形で足した
// ——押すとその場で確かめが出て、確かめてから入口を呼ぶ。

import { useCallback, useEffect, useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";

type StoreStatus = "pending" | "approved" | "banned";

type StoreDetailDto = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  status: StoreStatus;
  url: string | null;
  genres: string[];
  menus: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  license: boolean;
  cardRegistered: boolean;
};

type Props = { storeId: string };

const STATUS_LABELS: Record<StoreStatus, string> = {
  pending: "未承認",
  approved: "承認済み",
  banned: "止められている",
};

/** 承認に足りないもの（基準 25.2）。表示の名前は画面の側が持つ（項目の名前と同じ扱い）。 */
const missingLabels = (store: StoreDetailDto): string[] => [
  ...(store.license ? [] : ["営業許可書"]),
  ...(store.cardRegistered ? [] : ["カードの登録"]),
];

const budgetText = (store: StoreDetailDto): string =>
  store.budgetMin === null || store.budgetMax === null ? "まだありません" : `${store.budgetMin}円〜${store.budgetMax}円`;

export const StoreDetail = ({ storeId }: Props) => {
  const [store, setStore] = useState<StoreDetailDto | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [confirmingBan, setConfirmingBan] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  const load = useCallback(async () => {
    const result = await apiCall<{ store: StoreDetailDto }>("GET", `/api/admin/stores/${storeId}`);
    return isFailure(result) ? { store: null, failure: result } : { store: result.store, failure: null };
  }, [storeId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await load();
      if (!alive) return;
      setStore(next.store);
      setFailure(next.failure);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  /** 承認・停止・復帰のあとは、詳細を取り直して今の状況を映す（断られたときはその場に留まる）。 */
  const act = async (path: string) => {
    const result = await apiCall("POST", `/api/admin/stores/${storeId}/${path}`, {});
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    setFailure(null);
    setConfirmingBan(false);
    setConfirmingRestore(false);
    const next = await load();
    setStore(next.store);
  };

  if (!store) {
    return (
      <main>
        <FormMessage failure={failure} />
      </main>
    );
  }

  const missing = missingLabels(store);

  return (
    <main>
      <h1>{store.name}</h1>
      <p data-testid="store-status">{STATUS_LABELS[store.status]}</p>

      <dl>
        <dt>住所</dt>
        <dd>{store.address ?? "まだありません"}</dd>
        <dt>メールアドレス</dt>
        <dd>{store.email ? <a href={`mailto:${store.email}`}>{store.email}</a> : "まだありません"}</dd>
        <dt>ホームページ</dt>
        <dd>{store.url ?? "まだありません"}</dd>
        <dt>ジャンル</dt>
        <dd>{store.genres.length > 0 ? store.genres.join("・") : "まだありません"}</dd>
        <dt>おすすめメニュー</dt>
        <dd>{store.menus.length > 0 ? store.menus.join("・") : "まだありません"}</dd>
        <dt>予算の幅</dt>
        <dd>{budgetText(store)}</dd>
      </dl>

      <p data-testid="license-status">
        {store.license ? (
          <a href={`/api/admin/stores/${store.id}/license`} target="_blank" rel="noreferrer">
            営業許可書を開く
          </a>
        ) : (
          "営業許可書はまだ上がっていません"
        )}
      </p>
      <p data-testid="card-status">{store.cardRegistered ? "カードは登録済みです" : "カードはまだ登録されていません"}</p>

      {store.status === "pending" && (
        <form
          data-testid="form-approve"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void act("approve");
          }}
        >
          {missing.length > 0 && <p data-testid="approval-missing">{`${missing.join("と")}が揃うと承認できます。`}</p>}
          <button type="submit" data-testid="btn-approve" disabled={missing.length > 0}>
            承認する
          </button>
          <FormMessage failure={failure} />
        </form>
      )}

      {store.status === "approved" && (
        <div data-testid="form-ban">
          <button type="button" data-testid="btn-ban" onClick={() => setConfirmingBan(true)}>
            止める
          </button>
          {confirmingBan && (
            <div data-testid="confirm-ban" role="group" aria-label="止める前の確かめ">
              <p>公開中のオファーが終わり、確保中のお客さまの確保はすべて取り消されます。止めますか。</p>
              <button type="button" data-testid="btn-confirm" onClick={() => void act("ban")}>
                止める
              </button>
              <button type="button" onClick={() => setConfirmingBan(false)}>
                やめる
              </button>
            </div>
          )}
          <FormMessage failure={failure} />
        </div>
      )}

      {store.status === "banned" && (
        <div data-testid="form-restore">
          <button type="button" data-testid="btn-restore" onClick={() => setConfirmingRestore(true)}>
            承認済みに戻す
          </button>
          {confirmingRestore && (
            <div data-testid="confirm-restore" role="group" aria-label="承認済みに戻す前の確かめ">
              {/* 何が戻らないかを先に見せる（基準 25.10。止めるときと同じ、押す前に結果を知らせる形） */}
              <p>終わったオファーと取り消されたお客さまの確保は戻りません。この店は公開し直せるようになります。戻しますか。</p>
              <button type="button" data-testid="btn-confirm" onClick={() => void act("restore")}>
                承認済みに戻す
              </button>
              <button type="button" onClick={() => setConfirmingRestore(false)}>
                やめる
              </button>
            </div>
          )}
          <FormMessage failure={failure} />
        </div>
      )}
    </main>
  );
};

export default StoreDetail;
