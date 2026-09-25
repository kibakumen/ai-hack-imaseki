// 客の画面（/me）の main と、画面の名前の h1（2026-09-25 監査の指摘 横断-12）。
// 客の画面は1つの URL で表示を切り替える（準備中・登録・取得・確保中…）ので、どの表示でもこの入れ物を通し、
// h1 をいつも1つ持つ（それまでは h1 が無く、読み上げでは画面の構造をつかめなかった）。
// 見た目の主役は各表示の見出し（h2）なので、h1 は目には出さない（店のホームの「今日のオファー」と同じ扱い）。

import type { ReactNode } from "react";

export const CUSTOMER_HEADING = "イマセキ（今入れるお店を探す）";

type CustomerMainProps = { children?: ReactNode; busy?: boolean; testId?: string };

export const CustomerMain = ({ children = null, busy = false, testId }: CustomerMainProps) => (
  <main aria-busy={busy || undefined} data-testid={testId}>
    <h1 className="visually-hidden">{CUSTOMER_HEADING}</h1>
    {children}
  </main>
);
