// 承認と公開に足りないもののチェックリスト（要件12の基準 12.8）。未承認の間、帯の下に出す。
// 「待っているのに承認されない」と思い違えないための表示なので、**足りているものも並べたまま**
// 印だけを外す（何が済んでいて何が残っているかが一目で分かる・設計書「店の画面」の1）。
//
// 足りないかどうかの判断は入口（usecases/storeHome）が済ませている。ここは印を付けて並べるだけ。

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
    { key: "profile", label: "店の情報（店名・住所・ジャンル・予算の幅）", missing: missingProfile.length > 0, href: "/store/profile" },
  ];

  return (
    <ul className="setup-checklist" data-testid="setup-checklist">
      {items.map((item) => (
        <li key={item.key} data-missing={String(item.missing)}>
          {item.missing ? (
            <a href={item.href}>{item.label}を登録する</a>
          ) : (
            <span>{item.label}（済み）</span>
          )}
        </li>
      ))}
    </ul>
  );
};

export default SetupChecklist;
