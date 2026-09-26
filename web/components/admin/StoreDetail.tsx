"use client";

// 運営の店の詳細（要件24の基準 24.10・24.11／要件25の基準 25.2・25.3・25.5）。
// 開いた時に詳細の入口を1回呼び、返ってきた中身を描く。承認を断る操作は置かない（基準 25.3）。
// 止めるときは、何が起きるかを見せて確かめを取ってから入口を呼ぶ（基準 25.5）。
//
// 2026-09-21 タスク21 が「承認済みに戻す」（基準 25.9・25.10）を、「止める」と同じ形で足した。
// 2026-09-22 速成版の磨き込みを移植（本人選択）: 停止のボタンの文言を「登録を取り消す」に（`btn-ban` は同じ）。
// 2026-09-22 本人の指摘「UIが簡素すぎる」で、項目を「店の情報」「書類とカード」「操作」の3枚に束ねた。
//
// 2026-09-25 監査の指摘で組み直した:
//   - 取り消しと戻すは理由を入れるまで押せない。仮のパスワードは運営の今のパスワードを求める（運営-01）
//   - 止める前に「今 N 組が向かっています」、止めたあと「N 組を取り消し、M 人に通知しました」（運営-03）
//   - 断り（409）が今の状況を持っていれば、詳細を取り直して「ほかの操作で、すでに『◯◯』に」と出す。
//     送っている間は押せない（運営-04）
//   - 断りは操作ごとに持つ（components/ui/useSubmit・横断-03 で全画面の共通にした）。「やめる」で消す（運営-13）
//   - 承認後の変更・審査の手がかり・通報・操作の履歴（運営-02・運営-05・運営-09）は StoreReviewPanel・StoreDetailPanels
//   - 一覧の絞り込み・検索・並び順を持ったまま一覧へ戻る（運営-06）
//   ⚠️ data-testid・ボタンの文言・確かめの文の3語（オファー／確保／取り消）は受け入れ検査が見ている。
//   ⚠️ 色の値はここに書かない（構造の検査 34）。全部 `admin.module.css` が持つ。断りの文は InputRefusal が出す。

import Link from "next/link";
import { useCallback, useState } from "react";
import { callApi, isFailure, type AdminStoreDetailDto, type ApiFailure, type ResponseOf } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { FormMessage } from "../ui/InputRefusal";
import { LoadView, RefreshFailedBand } from "../ui/LoadState";
import { ConfirmBox } from "./ConfirmBox";
import { StoreDocuments, StoreFacts, StoreHistory, StoreImpact, StoreReportsPanel } from "./StoreDetailPanels";
import { ApprovalChanges, CHANGED_SINCE_SEEN_TEXT, seenOf, StoreReviewPanel } from "./StoreReviewPanel";
import { TempPasswordPanel } from "./TempPasswordPanel";
import { SubmitButton } from "../ui/Submit";
import { useSubmit, type Submit } from "../ui/useSubmit";
import styles from "./admin.module.css";
import { TERMS, WITHDRAWN_STORE_LABEL } from "../../lib/domain/texts";
import { dateTimeInJst } from "../ui/jstTime";

// 応答の型は、サーバーと同じ定義（schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
type DetailResponse = ResponseOf<"GET /api/admin/stores/:id">;
type StoreDetailDto = AdminStoreDetailDto;
type StoreStatus = StoreDetailDto["status"];

/** `listQuery` は一覧の絞り込み・検索・並び順（`filter=…&q=…&sort=…`）。戻るリンクに付けて一覧へ返す（運営-06）。 */
type Props = { storeId: string; listQuery?: string };

const STATUS_LABELS: Record<StoreStatus, string> = {
  pending: "未承認",
  approved: "承認済み",
  banned: TERMS.storeBanned,
};

const statusLabel = (state: string): string => STATUS_LABELS[state as StoreStatus] ?? state;

/** 承認に足りないもの（基準 25.2）。表示の名前は画面の側が持つ（項目の名前と同じ扱い）。 */
const missingLabels = (store: StoreDetailDto): string[] => [...(store.license ? [] : ["営業許可書"]), ...(store.cardRegistered ? [] : ["カードの登録"])];

/**
 * 操作が通ったあと・状況が先に変わっていたときに、操作の面の上に出す1行。`changed` は、状況は同じだが
 * 開いている間に店名・住所・許可書が変わっていた断り（承認・運営-02 のレビュー）。
 */
type Notice = { kind: "result"; text: string } | { kind: "conflict"; state: string; changed: boolean };

type OperationProps = { store: StoreDetailDto; onDone: (notice: Notice) => Promise<void> };

/**
 * 1つの操作を送り、結果を詳細へ返す。通れば `resultText`、状況が合わない断り（409 の `current`）なら
 * 今の状況を知らせて取り直す（運営-04）。そのほかの断りは操作の欄の直下に残す（運営-13）。
 */
const sendOperation = async <T,>(action: Submit, send: () => Promise<T | ApiFailure>, onDone: OperationProps["onDone"], resultText: (response: T) => string): Promise<void> => {
  const result = await action.run(send);
  if (result === null) return;
  if (!isFailure(result)) {
    await onDone({ kind: "result", text: resultText(result) });
    return;
  }
  const current = result.current;
  if (!current) return;
  action.clear();
  await onDone({ kind: "conflict", state: current.state, changed: current.changed === true });
};

/**
 * 承認（基準 25.1・25.2）。足りないものがあれば押せず、足りないものを出す。
 * この画面で見ている店名・住所・許可書を上げた日時を載せる——開いている間に店が変えていたら、サーバーが断る（運営-02 のレビュー）。
 */
const ApproveForm = ({ store, onDone }: OperationProps) => {
  const approve = useSubmit();
  const missing = missingLabels(store);
  const body = { seen: seenOf(store) };
  const send = () =>
    sendOperation(approve, () => callApi("POST /api/admin/stores/:id/approve", { params: { id: store.id }, body }), onDone, () => "承認しました。この店はオファーを公開できます。");
  return (
    <form
      data-testid="form-approve"
      className={`${styles.actionForm} ${styles.actionBlock}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h2>承認</h2>
      {missing.length > 0 ? (
        <p data-testid="approval-missing" className={styles.note}>{`${missing.join("と")}が揃うと承認できます。`}</p>
      ) : (
        <p className={styles.actionLead}>書類とカードが揃っています。承認すると、この店はオファーを公開できるようになります。</p>
      )}
      <SubmitButton type="submit" data-testid="btn-approve" busy={approve.busy} disabled={missing.length > 0}>
        承認する
      </SubmitButton>
      <FormMessage failure={approve.failure} />
    </form>
  );
};

type ReasonedOperation = {
  path: "ban" | "restore";
  formTestId: string;
  title: string;
  lead: string;
  buttonTestId: string;
  buttonLabel: string;
  confirmTestId: string;
  confirmText: (store: StoreDetailDto) => string;
  reasonLabel: string;
  danger: boolean;
};

const BAN: ReasonedOperation = {
  path: "ban",
  formTestId: "form-ban",
  title: "登録の取り消し",
  lead: "終わったオファーとキャンセルした確保は戻せません（店の承認は戻せます）。押すと先に確かめが出ます。",
  buttonTestId: "btn-ban",
  buttonLabel: "登録を取り消す",
  confirmTestId: "confirm-ban",
  // 営業許可書も消えることを先に言う（2026-09-25 安全-20 のレビュー。戻すときは承認待ちになり、店の上げ直しと承認のやり直しが要る）
  confirmText: (store) =>
    `今 ${store.activeReservations} 組が向かっています。公開中のオファーが終わり、確保中のお客さまの確保はすべてキャンセルされます（知らせを受け取れる方には通知が届きます）。営業許可書のファイルも消えるため、あとで戻すときは承認待ちになり、店の上げ直しと承認のやり直しが要ります。登録を取り消しますか。`,
  reasonLabel: "登録を取り消す理由（記録に残ります。店への連絡にも使えます）",
  danger: true,
};

const RESTORE: ReasonedOperation = {
  path: "restore",
  formTestId: "form-restore",
  title: "承認済みに戻す",
  lead: "この店がもう一度オファーを公開できるようにします。",
  buttonTestId: "btn-restore",
  buttonLabel: "承認済みに戻す",
  confirmTestId: "confirm-restore",
  // 何が戻らないかを先に見せる（基準 25.10。止めるときと同じ、押す前に結果を知らせる形）
  confirmText: () => "終わったオファーとキャンセルされたお客さまの確保は戻りません。この店は公開し直せるようになります。戻しますか。",
  reasonLabel: "戻す理由（記録に残ります）",
  danger: false,
};

/**
 * 止めたときに営業許可書と承認の写しを消した店（承認の写しが無い）を戻すとき（2026-09-25 安全-20 のレビュー・基準 25.9）。
 * 承認待ちへ戻るので、承認済みに戻すとは書かない。
 */
const RESTORE_TO_PENDING: ReasonedOperation = {
  ...RESTORE,
  title: "登録の取り消しを戻す（承認待ちへ）",
  lead: "登録を取り消したときに営業許可書を消したため、戻すと承認待ちになります。店が許可書を上げ直したら、確かめてから承認してください。",
  buttonLabel: "承認待ちに戻す",
  confirmText: () => "終わったオファーとキャンセルされたお客さまの確保は戻りません。この店は承認待ちに戻り、営業許可書を上げ直して承認されるまで公開できません。戻しますか。",
};

/** 戻す操作の文。承認の写しが残っていれば承認済みへ、無ければ承認待ちへ戻る（サーバーの restoreBannedStore と同じ見分け） */
const restoreOperation = (store: StoreDetailDto): ReasonedOperation => (store.approval === null ? RESTORE_TO_PENDING : RESTORE);

/** 止めたあとの1行（運営-03）。 */
const banResultText = (response: ResponseOf<"POST /api/admin/stores/:id/ban">): string =>
  `登録を取り消しました。${response.cancelled} 組の確保をキャンセルし、${response.notified} 人に通知しました。`;

/** 戻したあとの1行。戻した先はサーバーが返す（安全-20 のレビュー） */
const restoreResultText = (response: ResponseOf<"POST /api/admin/stores/:id/restore">): string =>
  response.status === "pending" ? "承認待ちに戻しました。店が営業許可書を上げ直したら、確かめてから承認してください。" : "承認済みに戻しました。";

/** 理由を求める操作（取り消し・戻す・運営-01）。確かめの箱に理由の欄を出し、入れるまで押せない。 */
const ReasonedForm = ({ store, onDone, op }: OperationProps & { op: ReasonedOperation }) => {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const action = useSubmit();
  const params = { params: { id: store.id }, body: { reason: reason.trim() } };
  const send = () =>
    op.path === "ban"
      ? sendOperation(action, () => callApi("POST /api/admin/stores/:id/ban", params), onDone, banResultText)
      : sendOperation(action, () => callApi("POST /api/admin/stores/:id/restore", params), onDone, restoreResultText);
  const cancel = () => {
    setConfirming(false);
    action.clear();
  };
  return (
    <div data-testid={op.formTestId} className={styles.actionBlock}>
      <h2>{op.title}</h2>
      <p className={styles.actionLead}>{op.lead}</p>
      <div className={styles.btnRow}>
        <button type="button" data-testid={op.buttonTestId} className={op.danger ? styles.dangerBtn : undefined} onClick={() => setConfirming(true)}>
          {op.buttonLabel}
        </button>
      </div>
      {confirming && (
        <ConfirmBox
          testId={op.confirmTestId}
          label={`${op.title}の前の確かめ`}
          text={op.confirmText(store)}
          confirmLabel={op.buttonLabel}
          danger={op.danger}
          busy={action.busy}
          reason={{ value: reason, onChange: setReason, label: op.reasonLabel }}
          onConfirm={() => void send()}
          onCancel={cancel}
        >
          <FormMessage failure={action.failure} />
        </ConfirmBox>
      )}
    </div>
  );
};

const NoticeLine = ({ notice }: { notice: Notice | null }) => {
  if (!notice) return null;
  if (notice.kind === "conflict") {
    return (
      <p data-testid="state-conflict" className={styles.note} role="alert">
        {notice.changed ? CHANGED_SINCE_SEEN_TEXT : `ほかの操作で、すでに『${statusLabel(notice.state)}』になっていました。今の状況に合わせて表示し直しました。`}
      </p>
    );
  }
  return (
    <p data-testid="action-result" className={styles.resultNote} role="status">
      {notice.text}
    </p>
  );
};

/**
 * 退会した店の操作の面（2026-09-26 本人発案の店の退会）。アカウント・店舗情報・許可書がもう無いので、戻す操作も
 * 仮のパスワードも出さない（入口も断る）。残っている記録（確保・通報・操作の履歴）は、この画面の他の面で読める。
 */
const WithdrawnNote = ({ withdrawnAt }: { withdrawnAt: string }) => (
  <section className={styles.panel} aria-labelledby="store-actions-title">
    <h2 id="store-actions-title" className={styles.panelTitle}>
      操作
    </h2>
    <p data-testid="store-withdrawn">
      この店は {dateTimeInJst(withdrawnAt)} に退会しました。アカウント・店舗情報・営業許可書・クーポンは消え、店名は伏せてあります。
      確保・通報・操作の履歴は残っています。戻す操作はありません（同じメールアドレスで登録し直した店は、新しい店として承認を待ちます）。
    </p>
  </section>
);

/** 操作の面（承認・取り消し・戻す・仮のパスワード）。状況ごとに出す操作を1つに絞る。 */
const Operations = ({ store, onDone, notice }: OperationProps & { notice: Notice | null }) => (
  <section className={styles.panel} aria-labelledby="store-actions-title">
    <h2 id="store-actions-title" className={styles.panelTitle}>
      操作
    </h2>
    <NoticeLine notice={notice} />
    {/* 状況が変わったら操作の欄を作り直す（開いたままの確かめ・前の状況の断りを残さない・運営-04） */}
    {store.status === "pending" && <ApproveForm key="approve" store={store} onDone={onDone} />}
    {store.status === "approved" && <ReasonedForm key="ban" store={store} onDone={onDone} op={BAN} />}
    {store.status === "banned" && <ReasonedForm key="restore" store={store} onDone={onDone} op={restoreOperation(store)} />}
    <TempPasswordPanel store={store} />
  </section>
);

/** 戻るリンク。一覧の絞り込み・検索・並び順が在れば付けて戻す（運営-06）。 */
const backHref = (listQuery: string | undefined): string => (listQuery ? `/admin?${listQuery}` : "/admin");

export const StoreDetail = ({ storeId, listQuery }: Props) => {
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async (): Promise<DetailResponse | ApiFailure> => callApi("GET /api/admin/stores/:id", { params: { id: storeId } }), [storeId]);
  // 読めなかった（ログインが切れた・見つからない・通信に失敗した）ときは、その語の文と読み直す道を出す（横断-01）。
  const { state, reload } = useLoad(load);

  /** 操作が通った・状況が先に変わっていた——どちらも詳細を取り直して今の状況を映す（運営-04）。 */
  const onDone = useCallback(
    async (next: Notice) => {
      setNotice(next);
      await reload();
    },
    [reload],
  );
  /** メモ・変更の確かめのあと。前の操作の知らせは消す。 */
  const refresh = useCallback(async () => {
    setNotice(null);
    await reload();
  }, [reload]);

  if (state.status !== "ready" && state.status !== "empty") {
    return (
      <main className={styles.page}>
        {/* 読めるまでの見出し（横断-12。読めたら店名が h1 になる） */}
        <h1>店の詳細</h1>
        <LoadView state={state} onRetry={() => void reload()}>
          {() => null}
        </LoadView>
      </main>
    );
  }

  const { store, reports, history } = state.data;

  return (
    <main className={styles.page}>
      <RefreshFailedBand state={state} />
      <header className={`${styles.card} ${styles.detailHead}`}>
        <Link href={backHref(listQuery)} className={styles.backLink}>
          ← 店の一覧へ
        </Link>
        <div className={styles.cardHead}>
          <h1>{store.name}</h1>
          <p data-testid="store-status">
            <span className={styles.badge} data-status={store.status}>
              {store.withdrawnAt ? WITHDRAWN_STORE_LABEL : STATUS_LABELS[store.status]}
            </span>
          </p>
          {store.changedSinceApproval && (
            <span className={styles.badge} data-status="pending">
              承認後に変更あり
            </span>
          )}
        </div>
        <StoreImpact store={store} reportCount={reports.count} />
      </header>

      <ApprovalChanges store={store} onChanged={refresh} />

      <div className={styles.detailGrid}>
        <div className={styles.detailSide}>
          <StoreFacts store={store} />
          <StoreReviewPanel store={store} onChanged={refresh} />
          <StoreHistory history={history} />
        </div>

        <div className={styles.detailSide}>
          <StoreDocuments store={store} />
          {store.withdrawnAt ? <WithdrawnNote withdrawnAt={store.withdrawnAt} /> : <Operations store={store} onDone={onDone} notice={notice} />}
          <StoreReportsPanel reports={reports} />
        </div>
      </div>
    </main>
  );
};

export default StoreDetail;
