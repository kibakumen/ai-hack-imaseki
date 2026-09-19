import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-10">
      <div>
        <p className="text-sm font-medium text-orange-600">AI HACK 2026 ・ チームD</p>
        <h1 className="mt-1 text-3xl font-bold">席アキ</h1>
        <p className="mt-2 text-neutral-600">空いた席を、近くにいて好みの合うお客さんへ。店主はスマホで10秒、あとは配信の波が自分で広がり、上限で止まります。</p>
      </div>
      <Link href="/me" className="rounded-2xl bg-orange-500 px-5 py-4 text-center text-lg font-bold text-white">お客さんとして登録する</Link>
      <p className="rounded-xl bg-neutral-100 p-4 text-sm text-neutral-600">店側の画面は、店ごとの秘密の鍵つきの URL（<code>/store?key=…</code>）から開きます。</p>
      <ul className="space-y-1 text-sm text-neutral-500">
        <li>・相手選びと配信の制御は決定論（LLM を使わない）</li>
        <li>・LLM は入口（好みの読み取り）と出口（通知文）だけ。OrcaRouter 経由</li>
        <li>・LLM の出力は検査し、落ちたら書き直し／定型文へ</li>
      </ul>
    </main>
  );
}
