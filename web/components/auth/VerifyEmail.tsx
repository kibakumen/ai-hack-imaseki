"use client";

// 確認のリンクを開いた画面（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ）。URL の `token` を入口
// GET /api/auth/verify-email へ渡し、結果を1行で見せる。見分けは要らない（メールを開いた端末で
// ログインしていないことが多い）。断りの語は読まない——描くのは components/ui/InputRefusal だけ。
// `useSearchParams` を使わないのは、静的な組み込みで Suspense の囲いを求められるため（値は開いた後に読めば足りる）。

import { useEffect, useState } from "react";
import { callApi, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";

type State = { phase: "checking" } | { phase: "done" } | { phase: "refused"; failure: ApiFailure };

const MISSING_TOKEN: ApiFailure = { ok: false, error: { kind: "verification_failed" } };

export const VerifyEmail = () => {
  const [state, setState] = useState<State>({ phase: "checking" });

  useEffect(() => {
    let alive = true;
    const token = new URLSearchParams(window.location.search).get("token");
    // token が無ければ入口を呼ばず、無い token と同じ断りにする（結果は同じ経路で受ける）
    // 呼ぶのは入口の鍵で（成功の応答は形の表 schemas/responses で確かめてから返る・設計-07）
    const outcome = token ? callApi("GET /api/auth/verify-email", { query: { token } }) : Promise.resolve(MISSING_TOKEN);
    void outcome.then((result) => {
      if (!alive) return;
      if (!isFailure(result)) return setState({ phase: "done" });
      // 口の無い公開先の 404（not_found）も、リンクが使えないことに変わりはないので同じ文にする（在る無しを教えない）
      setState({ phase: "refused", failure: result.error?.kind === "not_found" ? MISSING_TOKEN : result });
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
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
    </>
  );
};

export default VerifyEmail;
