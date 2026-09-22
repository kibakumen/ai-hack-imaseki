"use client";

// 運営の店の詳細（要件24の基準 24.10・24.11／要件25の基準 25.2・25.3・25.5）。
// 開いた時に詳細の入口を1回呼び、返ってきた中身を描く。承認を断る操作は置かない（基準 25.3）。
// 止めるときは、何が起きるかを見せて確かめを取ってから入口を呼ぶ（基準 25.5）。
//
// 2026-09-21 タスク21 が「承認済みに戻す」（基準 25.9・25.10）を、「止める」と同じ形で足した
// ——押すとその場で確かめが出て、確かめてから入口を呼ぶ。
//
// 2026-09-22 速成版の磨き込みを移植（本人選択）: 停止のボタンの文言を「止める」から
// 「登録を取り消す」に変える（`btn-ban` の入口とテキストは変えていない・確かめの文言は
// オファー／確保／取り消の3語を含んだまま・受け入れ検査 r24-admin.ui.test.tsx:65-73）。
//
// 2026-09-22 本人の指摘「UIが簡素すぎるので他の所と同じようにリッチにしてほしい」で見せ方を組み直した:
//   - 項目を「店の情報」「書類とカード」「操作」の3枚に束ねる（`admin.module.css` の `.panel`）
//   - 素の `<dl>` のぶら下げをやめ、`dt`/`dd` を2列のグリッドに（`.facts`）。空は `.noData` で淡く
//   - 営業許可書・カードの有無は `.badge[data-status]` の印にする（一覧の状況バッジと同じ語彙）
//   ⚠️ data-testid・ボタンの文言・確かめの文は変えていない（受け入れ検査が DOM を見ている）。
//   ⚠️ 色の値はここに書かない（構造の検査 34）。全部 `admin.module.css` が持つ。

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";
import styles from "./admin.module.css";

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

const EMPTY_TEXT = "まだありません";

/** 承認に足りないもの（基準 25.2）。表示の名前は画面の側が持つ（項目の名前と同じ扱い）。 */
const missingLabels = (store: StoreDetailDto): string[] => [
  ...(store.license ? [] : ["営業許可書"]),
  ...(store.cardRegistered ? [] : ["カードの登録"]),
];

/** 空の値は淡く出す（埋まっている情報と同じ重さで並べない）。 */
const Empty = () => <span className={styles.noData}>{EMPTY_TEXT}</span>;

/** ジャンル・おすすめメニューは1つずつ札にする。無ければ空の印。 */
const Chips = ({ items }: { items: string[] }) =>
  items.length === 0 ? (
    <Empty />
  ) : (
    <span className={styles.chips}>
      {items.map((item) => (
        <span key={item} className={styles.chip}>
          {item}
        </span>
      ))}
    </span>
  );

const Budget = ({ store }: { store: StoreDetailDto }) =>
  store.budgetMin === null || store.budgetMax === null ? (
    <Empty />
  ) : (
    <span className={styles.tabularNums}>{`${store.budgetMin}円〜${store.budgetMax}円`}</span>
  );

/** 店の情報（項目の2列）。`dt`/`dd` を直接グリッドに並べるので桁が揃う。 */
const StoreFacts = ({ store }: { store: StoreDetailDto }) => (
  <section className={styles.panel} aria-labelledby="store-facts-title">
    <h2 id="store-facts-title" className={styles.panelTitle}>
      店の情報
    </h2>
    <dl className={styles.facts}>
      <dt>住所</dt>
      <dd>{store.address ?? <Empty />}</dd>
      <dt>メールアドレス</dt>
      <dd>{store.email ? <a href={`mailto:${store.email}`}>{store.email}</a> : <Empty />}</dd>
      <dt>ホームページ</dt>
      <dd>
        {store.url ? (
          <a href={store.url} target="_blank" rel="noreferrer">
            {store.url}
          </a>
        ) : (
          <Empty />
        )}
      </dd>
      <dt>ジャンル</dt>
      <dd>
        <Chips items={store.genres} />
      </dd>
      <dt>おすすめメニュー</dt>
      <dd>
        <Chips items={store.menus} />
      </dd>
      <dt>予算の幅</dt>
      <dd>
        <Budget store={store} />
      </dd>
    </dl>
  </section>
);

type CheckRowProps = { testId: string; ready: boolean; readyLabel: string; missingLabel: string; children: ReactNode };

/** 書類とカードの1行。揃っていれば「承認済み」の色、まだなら「未承認」の色の印を付ける。 */
const CheckRow = ({ testId, ready, readyLabel, missingLabel, children }: CheckRowProps) => (
  <li data-testid={testId} className={styles.checkRow} data-ready={ready ? "true" : "false"}>
    <span className={styles.badge} data-status={ready ? "approved" : "pending"}>
      {ready ? readyLabel : missingLabel}
    </span>
    <span>{children}</span>
  </li>
);

const StoreDocuments = ({ store }: { store: StoreDetailDto }) => (
  <section className={styles.panel} aria-labelledby="store-documents-title">
    <h2 id="store-documents-title" className={styles.panelTitle}>
      書類とカード
    </h2>
    <ul className={styles.checkList}>
      <CheckRow testId="license-status" ready={store.license} readyLabel="提出済み" missingLabel="未提出">
        {store.license ? (
          <a href={`/api/admin/stores/${store.id}/license`} target="_blank" rel="noreferrer">
            営業許可書を開く
          </a>
        ) : (
          "営業許可書はまだ上がっていません"
        )}
      </CheckRow>
      <CheckRow testId="card-status" ready={store.cardRegistered} readyLabel="登録済み" missingLabel="未登録">
        {store.cardRegistered ? "カードは登録済みです" : "カードはまだ登録されていません"}
      </CheckRow>
    </ul>
  </section>
);

type ConfirmProps = { testId: string; label: string; text: string; confirmTestId?: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void };

/** 押す前の確かめ（止める・戻す・仮のパスワード）。何が起きるかを先に見せて、確かめてから入口を呼ぶ。 */
const ConfirmBox = ({ testId, label, text, confirmTestId = "btn-confirm", confirmLabel, danger = false, onConfirm, onCancel }: ConfirmProps) => (
  <div data-testid={testId} role="group" aria-label={label} className={styles.confirmBox}>
    <p className={styles.confirmText}>{text}</p>
    <div className={styles.btnRow}>
      <button type="button" data-testid={confirmTestId} className={danger ? styles.dangerBtn : undefined} onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" className={styles.quietBtn} onClick={onCancel}>
        やめる
      </button>
    </div>
  </div>
);

export const StoreDetail = ({ storeId }: Props) => {
  const [store, setStore] = useState<StoreDetailDto | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [confirmingBan, setConfirmingBan] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [confirmingTemp, setConfirmingTemp] = useState(false);
  /** 発行した仮のパスワード。入口が見せるただ1回（基準 14.13）なので、この画面を離れると消える。 */
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  /** 【最終日】仮のパスワードの発行（基準 14.10〜14.13）。2026-09-22 に足した——入口は在ったが画面から呼ぶ道が無かった。 */
  const issueTemp = async () => {
    const result = await apiCall<{ tempPassword: string }>("POST", `/api/admin/stores/${storeId}/temp-password`, {});
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    setFailure(null);
    setConfirmingTemp(false);
    setTempPassword(result.tempPassword);
  };

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
      <main className={styles.page}>
        {failure === null && <p className={styles.noData}>読み込んでいます…</p>}
        <FormMessage failure={failure} />
      </main>
    );
  }

  const missing = missingLabels(store);

  return (
    <main className={styles.page}>
      <header className={`${styles.card} ${styles.detailHead}`}>
        <Link href="/admin" className={styles.backLink}>
          ← 店の一覧へ
        </Link>
        <div className={styles.cardHead}>
          <h1>{store.name}</h1>
          <p data-testid="store-status">
            <span className={styles.badge} data-status={store.status}>{STATUS_LABELS[store.status]}</span>
          </p>
        </div>
      </header>

      <div className={styles.detailGrid}>
        <StoreFacts store={store} />

        <div className={styles.detailSide}>
          <StoreDocuments store={store} />

          <section className={styles.panel} aria-labelledby="store-actions-title">
            <h2 id="store-actions-title" className={styles.panelTitle}>
              操作
            </h2>

            {store.status === "pending" && (
              <form
                data-testid="form-approve"
                className={`${styles.actionForm} ${styles.actionBlock}`}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("approve");
                }}
              >
                <h2>承認</h2>
                {missing.length > 0 ? (
                  <p data-testid="approval-missing" className={styles.note}>{`${missing.join("と")}が揃うと承認できます。`}</p>
                ) : (
                  <p className={styles.actionLead}>書類とカードが揃っています。承認すると、この店はオファーを公開できるようになります。</p>
                )}
                <button type="submit" data-testid="btn-approve" disabled={missing.length > 0}>
                  承認する
                </button>
                <FormMessage failure={failure} />
              </form>
            )}

            {store.status === "approved" && (
              <div data-testid="form-ban" className={styles.actionBlock}>
                <h2>登録の取り消し</h2>
                <p className={styles.actionLead}>戻せない操作です。押すと先に確かめが出ます。</p>
                <div className={styles.btnRow}>
                  <button type="button" data-testid="btn-ban" className={styles.dangerBtn} onClick={() => setConfirmingBan(true)}>
                    登録を取り消す
                  </button>
                </div>
                {confirmingBan && (
                  <ConfirmBox
                    testId="confirm-ban"
                    label="登録を取り消す前の確かめ"
                    text="公開中のオファーが終わり、確保中のお客さまの確保はすべて取り消されます。登録を取り消しますか。"
                    confirmLabel="登録を取り消す"
                    danger
                    onConfirm={() => void act("ban")}
                    onCancel={() => setConfirmingBan(false)}
                  />
                )}
                <FormMessage failure={failure} />
              </div>
            )}

            {store.status === "banned" && (
              <div data-testid="form-restore" className={styles.actionBlock}>
                <h2>承認済みに戻す</h2>
                <p className={styles.actionLead}>この店がもう一度オファーを公開できるようにします。</p>
                <div className={styles.btnRow}>
                  <button type="button" data-testid="btn-restore" onClick={() => setConfirmingRestore(true)}>
                    承認済みに戻す
                  </button>
                </div>
                {confirmingRestore && (
                  /* 何が戻らないかを先に見せる（基準 25.10。止めるときと同じ、押す前に結果を知らせる形） */
                  <ConfirmBox
                    testId="confirm-restore"
                    label="承認済みに戻す前の確かめ"
                    text="終わったオファーと取り消されたお客さまの確保は戻りません。この店は公開し直せるようになります。戻しますか。"
                    confirmLabel="承認済みに戻す"
                    onConfirm={() => void act("restore")}
                    onCancel={() => setConfirmingRestore(false)}
                  />
                )}
                <FormMessage failure={failure} />
              </div>
            )}

            <section data-testid="form-temp-password" className={styles.actionBlock} aria-labelledby="store-temp-password-title">
              <h2 id="store-temp-password-title">パスワードを忘れた店への対応</h2>
              {tempPassword === null ? (
                <>
                  <p className={styles.actionLead}>仮のパスワードを発行して、あなたのメールで店へ伝えます。</p>
                  <div className={styles.btnRow}>
                    <button type="button" data-testid="btn-temp-password" onClick={() => setConfirmingTemp(true)}>
                      仮のパスワードを発行する
                    </button>
                  </div>
                  {confirmingTemp && (
                    <ConfirmBox
                      testId="confirm-temp-password"
                      label="仮のパスワードを発行する前の確かめ"
                      text="今のパスワードは使えなくなり、この店の開いている画面はすべてログアウトされます。仮のパスワードはここに1回だけ表示され、あなたのメールで店へ伝えます。発行しますか。"
                      confirmTestId="btn-confirm-temp-password"
                      confirmLabel="発行する"
                      onConfirm={() => void issueTemp()}
                      onCancel={() => setConfirmingTemp(false)}
                    />
                  )}
                </>
              ) : (
                <div data-testid="temp-password-issued" className={styles.secret}>
                  <p className={styles.secretLabel}>仮のパスワード</p>
                  <code data-testid="temp-password" className={styles.secretCode}>
                    {tempPassword}
                  </code>
                  <p className={styles.secretHint}>
                    この値はここにしか表示されません。{store.email ? <a href={`mailto:${store.email}`}>{store.email}</a> : "店"} へあなたのメールで伝えてください。店は次のログインで新しいパスワードを決めます。
                  </p>
                </div>
              )}
              <FormMessage failure={failure} />
            </section>
          </section>
        </div>
      </div>
    </main>
  );
};

export default StoreDetail;
