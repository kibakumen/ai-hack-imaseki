"use client";

// 運営への連絡先（公開値の入口 `GET /api/config/public` の contactEmail）。取れなければ「準備中」と出す
// ——宛先の値を画面の組み立てに焼き込まない（連絡先は運営が環境の設定で入れ替える）。

import { useEffect, useState } from "react";
import { getPublicConfig } from "../../lib/client/api";

export const ContactEmail = () => {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const config = await getPublicConfig();
      if (alive) setEmail(config?.contactEmail ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (email === null) return <span data-testid="contact-email">（連絡先は準備中です）</span>;
  return (
    <a data-testid="contact-email" href={`mailto:${email}`}>
      {email}
    </a>
  );
};
