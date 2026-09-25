"use client";

// 審査の手がかり（2026-09-25 監査の指摘 運営-02・運営-05）。
//   - 承認後に店名・住所・許可書が変わった店は「承認後に変更あり」と、承認した時点の値を並べる。
//     確かめたら「今の内容を確かめた」で写しを取り直す（印を出しっぱなしにすると読み飛ばされるようになる）
//   - 登録日時・許可書を上げた日時・承認した日時・同じ店名か住所の登録の数
//   - 運営のメモと「連絡済み」の印（連絡済みの未承認は承認待ちの数から外れる。許可書が上げ直されたらまた数える）
// 断りの語を読むのは InputRefusal だけ（構造の検査）。ここは受け取った断りを渡すだけ。

import Link from "next/link";
import { useState } from "react";
import { callApi, isFailure, type AdminStoreDetailDto } from "../../lib/client/api";
import { ADMIN_NOTE_MAX } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";
import { dateTimeInJst } from "../ui/jstTime";
import { Empty } from "./StoreDetailPanels";
import { useAdminAction } from "./useAdminAction";
import styles from "./admin.module.css";

type StoreDetailDto = AdminStoreDetailDto;

type ReloadProps = { store: StoreDetailDto; onChanged: () => Promise<void> };

const FIELD_NAMES = ["note"];

/** 承認後の変更（運営-02）。写しの無い店・変わっていない店では何も出さない。 */
export const ApprovalChanges = ({ store, onChanged }: ReloadProps) => {
  const acknowledge = useAdminAction();
  if (!store.changedSinceApproval || !store.approval) return null;
  const approval = store.approval;

  const confirmChanges = async () => {
    const result = await acknowledge.run(() => callApi("POST /api/admin/stores/:id/acknowledge", { params: { id: store.id }, body: {} }));
    if (result !== null && !isFailure(result)) await onChanged();
  };

  return (
    <section data-testid="approval-changes" className={`${styles.panel} ${styles.changedPanel}`} aria-labelledby="approval-changes-title">
      <h2 id="approval-changes-title" className={styles.panelTitle}>
        承認後に変更あり
      </h2>
      <p className={styles.actionLead}>客に出ているのは今の値です。承認した時点の値と見比べて、なりすましでないかを確かめてください。</p>
      <dl className={styles.facts}>
        {store.changes.name && (
          <>
            <dt>店名</dt>
            <dd>{`承認した時点「${approval.name}」→ 今「${store.name}」`}</dd>
          </>
        )}
        {store.changes.address && (
          <>
            <dt>住所</dt>
            <dd>{`承認した時点「${approval.address ?? "なし"}」→ 今「${store.address ?? "なし"}」`}</dd>
          </>
        )}
        {store.changes.license && (
          <>
            <dt>営業許可書</dt>
            <dd>承認のあとで差し替えられました</dd>
          </>
        )}
      </dl>
      <div className={styles.btnRow}>
        {approval.license && (
          <a href={`/api/admin/stores/${store.id}/license?version=approved`} target="_blank" rel="noreferrer">
            承認に使った営業許可書を開く
          </a>
        )}
        <button type="button" data-testid="btn-acknowledge" disabled={acknowledge.busy} onClick={() => void confirmChanges()}>
          今の内容を確かめた
        </button>
      </div>
      <FormMessage failure={acknowledge.failure} />
    </section>
  );
};

const dateOrEmpty = (iso: string | null) => (iso ? dateTimeInJst(iso) : <Empty />);

/** 運営のメモと「連絡済み」の印（運営-05 の A）。 */
const NoteForm = ({ store, onChanged }: ReloadProps) => {
  const [note, setNote] = useState(store.note ?? "");
  const [contacted, setContacted] = useState(store.contacted);
  const [saved, setSaved] = useState(false);
  const save = useAdminAction();

  const submit = async () => {
    const result = await save.run(() => callApi("POST /api/admin/stores/:id/note", { params: { id: store.id }, body: { note, contacted } }));
    if (result === null) return;
    setSaved(!isFailure(result));
    if (!isFailure(result)) await onChanged();
  };

  return (
    <form
      data-testid="form-note"
      className={styles.actionForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="admin-store-note">運営のメモ（店には見えません）</label>
      <textarea id="admin-store-note" data-testid="field-note" rows={3} maxLength={ADMIN_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} />
      <FieldMessage name="note" failure={save.failure} ctx={{ field: "メモ", min: 0, max: ADMIN_NOTE_MAX }} />
      <label className={styles.checkLabel}>
        <input type="checkbox" data-testid="field-contacted" checked={contacted} onChange={(event) => setContacted(event.target.checked)} />
        店へ連絡済み（未承認のあいだは承認待ちの数から外す。許可書が上げ直されたら、また数える）
      </label>
      {store.contactedAt && <p className={styles.cardMeta}>{`連絡済みにした日時: ${dateTimeInJst(store.contactedAt)}`}</p>}
      <button type="submit" data-testid="btn-save-note" disabled={save.busy}>
        メモを保存する
      </button>
      <FormMessage failure={save.failure} fieldNames={FIELD_NAMES} />
      {saved && <p role="status">保存しました</p>}
    </form>
  );
};

/** 審査の手がかり（運営-05）。登録・許可書・承認の日時、同じ店名か住所の登録、メモ。 */
export const StoreReviewPanel = ({ store, onChanged }: ReloadProps) => (
  <section data-testid="store-review" className={styles.panel} aria-labelledby="store-review-title">
    <h2 id="store-review-title" className={styles.panelTitle}>
      審査の手がかり
    </h2>
    <dl className={styles.facts}>
      <dt>登録した日時</dt>
      <dd>{dateOrEmpty(store.createdAt)}</dd>
      <dt>許可書を上げた日時</dt>
      <dd>{dateOrEmpty(store.licenseUploadedAt)}</dd>
      <dt>承認した日時</dt>
      <dd>{dateOrEmpty(store.approval?.at ?? null)}</dd>
      <dt>似た登録</dt>
      <dd>
        {store.duplicates > 0 ? (
          <Link href={`/admin?q=${encodeURIComponent(store.name)}`}>{`同じ店名か住所の登録がほかに ${store.duplicates} 件`}</Link>
        ) : (
          "同じ店名か住所の登録はほかにありません"
        )}
      </dd>
    </dl>
    <NoteForm store={store} onChanged={onChanged} />
  </section>
);
