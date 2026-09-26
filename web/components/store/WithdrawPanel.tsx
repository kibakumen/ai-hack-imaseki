"use client";

// 店の退会（2026-09-26 本人発案・監査の指摘 安全-20 の残り。要件13の基準 13.13・13.17 の画面の側）。
//
// 取り返しがつかないので2段にする: 「退会の手続きへ」で確かめを開き、消えるもの・残るもの・向かっている客の組数を読んでから、
// 今のパスワードを入れて「退会する」を押す（入口 POST /api/store/withdraw が今のパスワードを確かめる）。
// 向かっている客の組数は、店のホームの向かっている客のうち確保中の行（`kind: "active"`）を数える——入口は確保中の確保を
// 取り消すので、期限切れ・完了済みの行は数えない。
//
// 登録取り消し済みの店には操作を出さず、運営への連絡を案内する（入口も断る・usecases/withdrawStore の注）。
// 断り（今のパスワードが合わない）は欄の直下、それ以外は操作の直下に出す（設計書「入力の誤りの出し方」）。

import Link from "next/link";
import { useState } from "react";
import { callApi, isFailure, type ApiFailure, type StoreHomeDto } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { PASSWORD_MAX } from "../../lib/schemas/limits";
import { WITHDRAWN_STORE_NAME } from "../../lib/domain/texts";
import { ContactEmail } from "../ui/ContactEmail";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { LoadView } from "../ui/LoadState";
import { SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";

const loadHome = (): Promise<StoreHomeDto | ApiFailure> => callApi("GET /api/store/home");

const FIELD_NAMES = ["currentPassword"];
const MISMATCH_KINDS = ["password_mismatch"];
/** 登録取り消し済みの断りを、退会の場面の文にする（domain/texts の store_banned） */
const REFUSAL_CTX = { action: "withdraw" };
const PASSWORD_ID = "withdraw-current-password";

type ConfirmProps = { activeCount: number; publishing: boolean; onWithdrawn: (cancelled: number) => void; onCancel: () => void };

/** 確かめの中身（消えるもの・残るもの・向かっている客）と、今のパスワードの欄。 */
const WithdrawConfirm = ({ activeCount, publishing, onWithdrawn, onCancel }: ConfirmProps) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const withdraw = useSubmit();
  const failure = withdraw.failure;

  const submit = async () => {
    const result = await withdraw.run(() => callApi("POST /api/store/withdraw", { body: { currentPassword } }));
    if (result === null || isFailure(result)) return;
    setCurrentPassword("");
    onWithdrawn(result.cancelled);
  };

  return (
    <div className="store-stack-sm" data-testid="confirm-withdraw" role="group" aria-label="退会の前の確かめ">
      <p>
        <strong>退会すると元に戻せません。</strong>
      </p>
      <ul>
        <li>消えるもの: ログインのアカウント・店舗情報・営業許可書のファイル・クーポン・店の画像。公開中のオファーは終わります。</li>
        <li>残るもの: これまでの確保・通報・運営の記録。店名は「{WITHDRAWN_STORE_NAME}」に置き換えて残り、お客さまの見返しにもそう出ます。</li>
        <li>同じメールアドレスで、あとから新しい店として登録し直せます（承認はやり直しです）。</li>
      </ul>
      {activeCount > 0 ? (
        <p data-testid="withdraw-active">
          <strong>今向かっているお客さま {activeCount} 組の確保は取り消され、お客さまに通知されます。</strong>
        </p>
      ) : null}
      {publishing ? <p>公開中のオファーは、退会と同時に終わります。</p> : null}

      <label htmlFor={PASSWORD_ID}>今のパスワード</label>
      <input
        id={PASSWORD_ID}
        data-testid="field-currentPassword"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        maxLength={PASSWORD_MAX}
        onChange={(event) => setCurrentPassword(event.target.value)}
        {...fieldAria("currentPassword", failure, PASSWORD_ID, { kinds: MISMATCH_KINDS })}
      />
      <FieldMessage name="currentPassword" inputId={PASSWORD_ID} failure={failure} ctx={{ field: "今のパスワード" }} kinds={MISMATCH_KINDS} />

      <p className="store-actions">
        <SubmitButton
          type="button"
          className="store-btn store-btn--danger"
          data-testid="btn-withdraw"
          busy={withdraw.busy}
          disabled={currentPassword === ""}
          onClick={() => void submit()}
        >
          退会する
        </SubmitButton>
        <button type="button" className="store-btn store-btn--quiet" disabled={withdraw.busy} onClick={onCancel}>
          やめる
        </button>
      </p>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} ctx={REFUSAL_CTX} />
    </div>
  );
};

/** 読み込んだホームから、退会の操作（または登録取り消し済みの案内）を描く。 */
const WithdrawBody = ({ home, onWithdrawn }: { home: StoreHomeDto; onWithdrawn: (cancelled: number) => void }) => {
  const [confirming, setConfirming] = useState(false);
  if (home.status === "banned") {
    return (
      <p data-testid="withdraw-banned">
        登録取り消し済みの間は、この画面から退会できません。退会や登録の情報の消去は、運営の連絡先（<ContactEmail />）へお知らせください。
      </p>
    );
  }
  if (!confirming) {
    return (
      <p>
        <button type="button" className="store-btn store-btn--quiet" data-testid="btn-withdraw-open" onClick={() => setConfirming(true)}>
          退会の手続きへ
        </button>
      </p>
    );
  }
  const activeCount = home.arrivals.filter((row) => row.kind === "active").length;
  return <WithdrawConfirm activeCount={activeCount} publishing={home.offer !== null} onWithdrawn={onWithdrawn} onCancel={() => setConfirming(false)} />;
};

export const WithdrawPanel = () => {
  const { state, reload } = useLoad(loadHome);
  const [withdrawn, setWithdrawn] = useState<number | null>(null);

  return (
    <section className="store-card store-stack-sm" data-testid="form-withdraw" aria-label="退会">
      <h2>退会</h2>
      {withdrawn !== null ? (
        <p data-testid="withdrawn" role="status">
          退会しました。{withdrawn > 0 ? `向かっていたお客さま ${withdrawn} 組の確保を取り消し、お知らせしました。` : ""}
          ご利用ありがとうございました。<Link href="/">トップへ</Link>
        </p>
      ) : (
        <LoadView
          state={state}
          onRetry={() => {
            void reload();
          }}
        >
          {(home) => <WithdrawBody home={home} onWithdrawn={setWithdrawn} />}
        </LoadView>
      )}
    </section>
  );
};

export default WithdrawPanel;
