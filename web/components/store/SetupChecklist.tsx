// 承認と公開に足りないもののチェックリスト（要件12の基準 12.8）。未承認の間、帯の下に出す。
// 「待っているのに承認されない」と思い違えないための表示なので、**足りているものも並べたまま**
// 印だけを外す（何が済んでいて何が残っているかが一目で分かる・設計書「店の画面」の1）。
//
// 足りないかどうかの判断は入口（usecases/storeHome）が済ませている。ここは印を付けて並べるだけ。
// 印は済み「✓」・未済「!」（2026-09-25 監査の指摘 店-14: それまでは印も見た目も無く、素の箇条書きだった）。

import { TERMS } from "../../lib/domain/texts";

export type SetupChecklistProps = {
  checklist: { license: boolean; card: boolean };
  /** 公開に足りない店の情報の項目（空なら店の情報は済んでいる） */
  missingProfile: string[];
};

type Item = { key: string; label: string; missing: boolean; href: string };

export const SetupChecklist = ({ checklist, missingProfile }: SetupChecklistProps) => {
  const items: Item[] = [
    { key: "license", label: "営業許可書", missing: !checklist.license, href: "/store/documents" },
    { key: "card", label: "カード", missing: !checklist.card, href: "/store/documents" },
    { key: "profile", label: `${TERMS.storeProfile}（店名・住所・ジャンル・予算の幅）`, missing: missingProfile.length > 0, href: "/store/profile" },
  ];

  const done = items.filter((item) => !item.missing).length;

  // 見出しに「3つのうち N つ済み」と細い棒を足した（2026-10-08 本人選択「案C 片手の親指」の承認待ちの店のホーム）
  return (
    <div className="setup-checklist" data-testid="setup-checklist">
      <p className="setup-checklist__head">
        承認に要るもの
        <span>
          {items.length}つのうち {done}つ済み
        </span>
      </p>
      <div className="store-meter" aria-hidden="true">
        <i style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="setup-checklist__list">
        {items.map((item) => (
          <li key={item.key} data-missing={String(item.missing)}>
            <span className="setup-checklist__mark" aria-hidden="true">
              {item.missing ? "!" : "✓"}
            </span>
            {item.missing ? (
              <a href={item.href}>{item.label}を登録する</a>
            ) : (
              <span>{item.label}（済み）</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** まだ済んでいないもののうち、いちばん先にやる1つ（承認待ちの店のホームの下に1つだけボタンを出す） */
export const nextSetupStep = ({ checklist, missingProfile }: SetupChecklistProps): { href: string; label: string } | null => {
  if (!checklist.license) return { href: "/store/documents", label: "営業許可書を登録する" };
  if (!checklist.card) return { href: "/store/documents", label: "カードを登録する" };
  if (missingProfile.length > 0) return { href: "/store/profile", label: `${TERMS.storeProfile}を入れる` };
  return null;
};

/** まだ済んでいないものの数（下のナビの「店舗情報」に付ける） */
export const missingSetupCount = ({ checklist, missingProfile }: SetupChecklistProps): number =>
  [!checklist.license, !checklist.card, missingProfile.length > 0].filter(Boolean).length;

export default SetupChecklist;
