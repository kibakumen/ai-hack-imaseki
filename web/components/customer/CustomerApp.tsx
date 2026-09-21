"use client";

// 客の画面（/me）の入れ物。開いた時にまずホームの入口を1回呼び、返ってきた表示の種類を描く
// （設計書「客の画面」の優先の順）。識別子が無い・受け付けられない（断り）なら登録の入力を出し、
// 取得の画面は出さない（基準 1.10・1.11）。登録が済んだ客には取得の画面を出す（基準 1.8）。
// ⚠️ 確保中・期限切れ・取り消し・完了済みの表示は、タスク13〜16 がここへ足す。

import { useCallback, useEffect, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";
import { FetchForm, type FetchResult } from "./FetchForm";
import { RegisterForm } from "./RegisterForm";
import { ResultList } from "./ResultList";

/** ホームの応答（`GET /api/customer/home`）。形は検査していないので、在ることに頼らずに読む。 */
type CustomerHome = { kind: string; profile?: { genres?: string[]; budgetMax?: number | null } };
type View = { kind: "loading" } | { kind: "register" } | { kind: "home"; home: CustomerHome };

export const CustomerApp = () => {
  const [view, setView] = useState<View>({ kind: "loading" });
  // 取得の結果と人数は取得の画面の続きとして、入れ物の側が持つ（設計書「客の画面」の結果の行）。
  // 人数をここに置く理由は FetchForm の party の注（結果の側から入れ替わるのは人数だけ）。
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  // 人数の初めの値は置かない（要件3の補足。前回の人数が残ると人数の変化を見落とす）。
  const [party, setParty] = useState("");

  /** ホームを1回呼んで、出すべき表示を決める（断り＝識別子が無い・受け付けられない → 登録の入力）。 */
  const loadHome = useCallback(async (): Promise<View> => {
    const result = await apiCall<CustomerHome>("GET", "/api/customer/home");
    return isFailure(result) ? { kind: "register" } : { kind: "home", home: result };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadHome();
      if (alive) setView(next);
    })();
    return () => {
      alive = false;
    };
  }, [loadHome]);

  const reload = () => {
    void (async () => setView(await loadHome()))();
  };

  if (view.kind === "loading") return <main aria-busy="true" />;

  if (view.kind === "register") {
    return (
      <main>
        <RegisterForm onRegistered={reload} />
      </main>
    );
  }

  return (
    <main>
      {view.home.kind === "fetch" && (
        <section data-testid="view-fetch">
          <FetchForm profile={view.home.profile} party={party} onPartyChange={setParty} onResults={setFetchResult} />
          {fetchResult !== null && <ResultList items={fetchResult.items} />}
        </section>
      )}
    </main>
  );
};

export default CustomerApp;
