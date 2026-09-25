"use client";

// 書類の画面（要件13）。営業許可書を上げる欄と、カードを登録する操作の2つだけ。
// カードの番号はこの画面に入れない——外の決済の画面へ移り、戻ってきたら登録済みかどうかだけを出す
// （基準 13.7・13.8。入力欄そのものが無いことを受け入れ検査が見る）。
//
// 断られたときは、ファイルの欄の直下（種類・大きさ）か「カードを登録する」の直下（やり直し）に文が出て、
// 画面はそのまま、前に登録したものの表示も変わらない（設計書「入力の誤りの出し方」の 13.3 の行）。

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { callApi, isFailure, type ApiFailure, type StoreHomeDto } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { LICENSE_MAX_MEGABYTES } from "../../lib/schemas/limits";
import { DOCUMENTS_TEXTS } from "../../lib/domain/texts";
import { ContactEmail } from "../ui/ContactEmail";
import { FieldKindMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { LoadView } from "../ui/LoadState";
import { cameBackFromCardSetup, clearCardReturnMark, confirmCardSetup, resetAutoConfirmTurn, takeAutoConfirmTurn } from "./cardReturn";

/** 店のホームの応答のうち、この画面が読む分（型は schemas/responses の表から・設計-07）。 */
type DocumentsView = Pick<StoreHomeDto, "checklist" | "cardSetupPending" | "status">;

const REGISTERED = "登録済み";
const NOT_REGISTERED = "まだ登録されていません";
const ACCEPTED_TYPES = "application/pdf,image/jpeg,image/png";

const loadView = (): Promise<DocumentsView | ApiFailure> => callApi("GET /api/store/home");

export const DocumentsPanel = () => {
  // 読めなかったときは空の section で止めず、断りの文と読み直す道を出す（2026-09-25 監査の指摘 横断-01）。
  const { state, reload } = useLoad(loadView);
  const [file, setFile] = useState<File | null>(null);
  const [licenseFailure, setLicenseFailure] = useState<ApiFailure | null>(null);
  const [cardFailure, setCardFailure] = useState<ApiFailure | null>(null);
  /** 開いたときの確かめを送ったか（1回だけ・不具合-01） */
  const cardChecked = useRef(false);

  // 決済会社の画面から戻ってきた（`?card=returned`）か、始めたまままだ確かめていない（`cardSetupPending`）なら、
  // 開いたときに確かめを1回送る（2026-09-25 カード登録が画面から完了しない件（不具合-01）の案1）。
  // 戻ってきた印の無い自動の確かめは、ホームと合わせて1つのブラウザのセッションで1回だけ（cardReturn の注）。
  // 戻ってきたのに通らなかったときだけ断りの文を出す——始めただけの店は、入力を終えていないだけかもしれない。
  const loaded = state.status === "ready" || state.status === "empty" ? state.data : null;
  useEffect(() => {
    if (loaded === null || cardChecked.current) return;
    cardChecked.current = true;
    const returned = cameBackFromCardSetup();
    clearCardReturnMark();
    if (loaded.checklist.card) return;
    if (!returned && !(loaded.cardSetupPending && takeAutoConfirmTurn())) return;
    void (async () => {
      const failure = await confirmCardSetup();
      if (failure === null) {
        setCardFailure(null);
        await reload();
        return;
      }
      if (returned) setCardFailure(failure);
    })();
  }, [loaded, reload]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  };

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const result = await callApi("POST /api/store/license", { body: form });
    if (isFailure(result)) {
      // 選んだファイルは残す（同じものを選び直させない）。前に登録した表示も触らない。
      setLicenseFailure(result);
      return;
    }
    setLicenseFailure(null);
    await reload();
  };

  /** 許可書を消す確かめを開いているか（安全-20） */
  const [askingDelete, setAskingDelete] = useState(false);

  /** 承認の前の店が、自分の許可書を消す（2026-09-25 監査の指摘 安全-20）。確かめてから送る。 */
  const deleteLicense = async () => {
    setAskingDelete(false);
    const result = await callApi("DELETE /api/store/license");
    if (isFailure(result)) {
      setLicenseFailure(result);
      await reload();
      return;
    }
    setLicenseFailure(null);
    await reload();
  };

  const startCardSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await callApi("POST /api/store/card/setup", { body: {} });
    if (isFailure(result)) {
      setCardFailure(result);
      return;
    }
    setCardFailure(null);
    // やり直したので、戻らずにタブを閉じても次に開いたとき1回は確かめる
    resetAutoConfirmTurn();
    // カードを打つのは外の画面（この画面には欄が無い・基準 13.7）。
    window.location.assign(result.url);
  };

  return (
    <section className="store-stack">
      <h2>書類</h2>

      <LoadView state={state} onRetry={() => void reload()}>
        {(view) => (
          <>
            <form
              data-testid="form-license"
              noValidate
              onSubmit={(event) => {
                void upload(event);
              }}
            >
              <h3>営業許可書</h3>
              <p data-testid="license-status">{view.checklist.license ? REGISTERED : NOT_REGISTERED}</p>
              <p>PDF・JPEG・PNG のファイルを{LICENSE_MAX_MEGABYTES}MB まで。壁に貼った許可書の写真でもかまいません。</p>
              {/* 保管の目的・消す時・連絡先（2026-09-25 監査の指摘 安全-20 の案1と案2） */}
              <p className="store-note" data-testid="license-retention">
                {DOCUMENTS_TEXTS.licenseRetention} <a href="/store/terms">{DOCUMENTS_TEXTS.termsLink}</a>
                {DOCUMENTS_TEXTS.contactLead}
                <ContactEmail />
              </p>

              <label htmlFor="license-file">ファイルを選ぶ</label>
              <input id="license-file" data-testid="field-file" type="file" accept={ACCEPTED_TYPES} onChange={chooseFile} {...fieldAria("file", licenseFailure, "license-file")} />
              <FieldKindMessage inputId="license-file" name="file" failure={licenseFailure} ctx={{ field: "ファイル", max: LICENSE_MAX_MEGABYTES }} />

              <button type="submit" data-testid="btn-upload-license" disabled={file === null}>
                営業許可書を上げる
              </button>
              <FormMessage failure={licenseFailure} fieldNames={["file"]} />

              {/* 承認の前だけ、店が自分で許可書を取り下げられる（承認済みは承認の根拠なので、退会は運営へ連絡・安全-20） */}
              {view.checklist.license && view.status !== "approved" ? (
                <button type="button" className="store-btn store-btn--quiet" data-testid="btn-delete-license" aria-expanded={askingDelete} onClick={() => setAskingDelete(true)}>
                  {DOCUMENTS_TEXTS.deleteLicense}
                </button>
              ) : null}
              {askingDelete ? (
                <div className="store-confirm" role="dialog" aria-label="営業許可書を消す確かめ" data-testid="confirm-delete-license">
                  <p>{DOCUMENTS_TEXTS.deleteLicenseConfirm}</p>
                  <div className="store-confirm__buttons">
                    <button
                      type="button"
                      className="store-btn store-btn--danger"
                      data-testid="btn-confirm-delete-license"
                      onClick={() => {
                        void deleteLicense();
                      }}
                    >
                      {DOCUMENTS_TEXTS.deleteLicense}
                    </button>
                    <button type="button" className="store-btn store-btn--quiet" onClick={() => setAskingDelete(false)}>
                      やめる
                    </button>
                  </div>
                </div>
              ) : null}
            </form>

            <form
              data-testid="form-card"
              noValidate
              onSubmit={(event) => {
                void startCardSetup(event);
              }}
            >
              <h3>カード</h3>
              <p data-testid="card-status">{view.checklist.card ? REGISTERED : NOT_REGISTERED}</p>
              <p>登録の入力は決済会社の画面で行います。この画面にはカードの内容を入れる欄がありません。</p>
              {/* カードを預かる目的と「今は請求しない」こと（2026-09-25 監査の指摘 店-21） */}
              <p className="store-note">
                {DOCUMENTS_TEXTS.cardPurpose} <a href="/store/terms">{DOCUMENTS_TEXTS.termsLink}</a>
              </p>

              <button type="submit" data-testid="btn-card-setup">
                カードを登録する
              </button>
              <FormMessage failure={cardFailure} />
            </form>
          </>
        )}
      </LoadView>
    </section>
  );
};

export default DocumentsPanel;
