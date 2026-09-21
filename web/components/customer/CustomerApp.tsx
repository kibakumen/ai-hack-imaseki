"use client";

// 客の画面（/me）の入れ物。開いた時にまずホームの入口を1回呼び、返ってきた表示の種類を描く
// （設計書「客の画面」の優先の順）。識別子が無い・受け付けられない（断り）なら登録の入力を出し、
// 取得の画面は出さない（基準 1.10・1.11）。登録が済んだ客には取得の画面を出す（基準 1.8）。
// ⚠️ 確保中・期限切れ・取り消し・完了済みの表示は、タスク13〜16 がここへ足す。

import { useCallback, useEffect, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";
import { RegisterForm } from "./RegisterForm";

type CustomerHome = { kind: string };
type View = { kind: "loading" } | { kind: "register" } | { kind: "home"; home: CustomerHome };

export const CustomerApp = () => {
  const [view, setView] = useState<View>({ kind: "loading" });

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
        // タスク12 が FetchForm（場所・人数・その回の好み）に置き換える。
        <section data-testid="view-fetch">
          <h2>今入れるお店を探す</h2>
          <button type="button" data-testid="btn-fetch">
            今入れる店を探す
          </button>
        </section>
      )}
    </main>
  );
};

export default CustomerApp;
