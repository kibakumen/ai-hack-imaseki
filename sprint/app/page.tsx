import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-widest text-orange-600">AI HACK 2026 ・ チームD</p>
        <h1 className="text-3xl font-bold">席アキ v2</h1>
        <p className="text-sm leading-relaxed text-neutral-600">
          店は「受け付ける時間」と「何名×何組」を置いておくだけ。客が「今すぐ探す」を押した瞬間に、
          近くで嗜好とメニューの合う店を AI が選んで返します。
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <Link href="/me" className="rounded-2xl bg-orange-500 px-5 py-4 text-center text-lg font-bold text-white">
          お客さんとして使う
        </Link>
        <p className="text-xs text-neutral-500">店の画面と運営の画面は、鍵つきの URL から開きます。</p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-neutral-200 p-4 text-sm">
        <h2 className="font-bold">この版でできること</h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-700">
          <li>客: 呼び名・電話番号・好み（自由文）を登録 → 人数と現在地で取得 → 8桁のクーポン番号を受け取る</li>
          <li>店: 住所・ホームページ・提供メニュー・オファー3つ（何名×何組・受付時間・外部クーポン）を編集</li>
          <li>運営: 登録店の一覧・オファー公開中の店・提供メニュー・新規店の承認</li>
          <li>AI（OrcaRouter）: 入口＝好みの読み取り／出口＝上位10件から最大5件の選定と理由</li>
        </ul>
      </section>
    </main>
  );
}
