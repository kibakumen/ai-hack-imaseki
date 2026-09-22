"use client";

// 確認のリンクを開いた画面（2026-09-22 追加・feat/email-verify）。URL の `token` を入口
// GET /api/auth/verify-email へ渡し、結果を1行で見せる。見分けは要らない（メールを開いた端末で
// ログインしていないことが多い）。断りの語は読まない——描くのは components/ui/InputRefusal だけ。
// `useSearchParams` を使わないのは、静的な組み込みで Suspense の囲いを求められるため（値は開いた後に読めば足りる）。

import { useEffect, useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";

type State = { phase: "checking" } | { phase: "done" } | { phase: "refused"; failure: ApiFailure };

const MISSING_TOKEN: ApiFailure = { ok: false, error: { kind: "verification_failed" } };

export const VerifyEmail = () => {
  const [state, setState] = useState<State>({ phase: "checking" });

  useEffect(() => {
    let alive = true;
    const token = new URLSearchParams(window.location.search).get("token");
    // token が無ければ入口を呼ばず、無い token と同じ断りにする（結果は同じ経路で受ける）
    const outcome = token ? apiCall("GET", `/api/auth/verify-email?token=${encodeURIComponent(token)}`) : Promise.resolve(MISSING_TOKEN);
    void outcome.then((result) => {
      if (!alive) return;
      setState(isFailure(result) ? { phase: "refused", failure: result } : { phase: "done" });
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="store-main">
      <h1>メールアドレスの確認</h1>
      {state.phase === "checking" && <p aria-busy="true">確認しています…</p>}
      {state.phase === "done" && (
        <>
          <p data-testid="email-verified">メールアドレスを確認しました。</p>
          <p>
            <a href="/store">店の画面へ</a>
          </p>
        </>
      )}
      {state.phase === "refused" && <FormMessage failure={state.failure} />}
    </main>
  );
};

export default VerifyEmail;
