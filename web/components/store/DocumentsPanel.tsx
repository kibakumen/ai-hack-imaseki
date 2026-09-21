"use client";

// 書類の画面（要件13）。営業許可書を上げる欄と、カードを登録する操作の2つだけ。
// カードの番号はこの画面に入れない——外の決済の画面へ移り、戻ってきたら登録済みかどうかだけを出す
// （基準 13.7・13.8。入力欄そのものが無いことを受け入れ検査が見る）。
//
// 断られたときは、ファイルの欄の直下（種類・大きさ）か「カードを登録する」の直下（やり直し）に文が出て、
// 画面はそのまま、前に登録したものの表示も変わらない（設計書「入力の誤りの出し方」の 13.3 の行）。

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { LICENSE_MAX_MEGABYTES } from "../../lib/schemas/limits";
import { FieldKindMessage, FormMessage } from "../ui/InputRefusal";

type DocumentsView = { checklist: { license: boolean; card: boolean } };

const REGISTERED = "登録済み";
const NOT_REGISTERED = "まだ登録されていません";
const ACCEPTED_TYPES = "application/pdf,image/jpeg,image/png";

export const DocumentsPanel = () => {
  const [view, setView] = useState<DocumentsView | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [licenseFailure, setLicenseFailure] = useState<ApiFailure | null>(null);
  const [cardFailure, setCardFailure] = useState<ApiFailure | null>(null);

  const loadView = useCallback(async (): Promise<DocumentsView | null> => {
    const result = await apiCall<DocumentsView>("GET", "/api/store/home");
    return isFailure(result) ? null : result;
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadView();
      if (alive) setView(next);
    })();
    return () => {
      alive = false;
    };
  }, [loadView]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  };

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const result = await apiCall("POST", "/api/store/license", form);
    if (isFailure(result)) {
      // 選んだファイルは残す（同じものを選び直させない）。前に登録した表示も触らない。
      setLicenseFailure(result);
      return;
    }
    setLicenseFailure(null);
    setView(await loadView());
  };

  const startCardSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall<{ url: string }>("POST", "/api/store/card/setup", {});
    if (isFailure(result)) {
      setCardFailure(result);
      return;
    }
    setCardFailure(null);
    // カードを打つのは外の画面（この画面には欄が無い・基準 13.7）。
    window.location.assign(result.url);
  };

  if (!view) return <section aria-busy="true" />;

  return (
    <section>
      <h2>書類</h2>

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

        <label htmlFor="license-file">ファイルを選ぶ</label>
        <input id="license-file" data-testid="field-file" type="file" accept={ACCEPTED_TYPES} onChange={chooseFile} />
        <FieldKindMessage name="file" failure={licenseFailure} ctx={{ field: "ファイル", max: LICENSE_MAX_MEGABYTES }} />

        <button type="submit" data-testid="btn-upload-license" disabled={file === null}>
          営業許可書を上げる
        </button>
        <FormMessage failure={licenseFailure} fieldNames={["file"]} />
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

        <button type="submit" data-testid="btn-card-setup">
          カードを登録する
        </button>
        <FormMessage failure={cardFailure} />
      </form>
    </section>
  );
};

export default DocumentsPanel;
