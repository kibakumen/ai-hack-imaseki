"use client";

// 店の実績の画面（要件23・設計書「店の画面」の下のナビの「実績」）。開いた時に入口を1回呼び、
// 返ってきた数をそのまま並べる（数え方は入口の側・設計書「概要」の芯の1）。
//
// 2026-09-25 監査の指摘 店-13 で作り直した: それまでは1行に公開の時刻と4つの数だけの表で、そのオファーの条件も
// 割合も合計も無く、スマホでは内訳が何行にも折り返し、次に何組・何名まで・どのクーポンで出すかを決める材料に
// ならなかった。今は——
//   - いちばん上に**今日と直近7日の合計**（出た→受け取られた→完了と、その割合）
//   - オファー1件を**1枚のカード**にして、条件（配信数・何名まで・時刻・クーポン）と終わった理由、
//     「出た → 受け取られた → 完了」の数と割合、取り消しの内訳を並べる
// 実績はクーポンごとではなくオファーごと（要件23の補足・本人選択）のまま。行にクーポンの有無を出すのは、この決定と
// 食い違わない。
//
// ⚠️ ここは読むだけの画面。押して何かが変わる操作は置かない。数字の取り直しも画面を開いた時だけ
//    （要件23の補足: 店が張り付く画面ではない）。
// ⚠️ 客のデータ（呼び名・電話番号）は入口が返さないので、この画面にも出ない（基準 27.6・28.2）。

import { useEffect, useState } from "react";
import { callApi, isFailure, type ApiFailure, type ResponseOf } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";
import { StoreNav } from "./StoreNav";
import { dateTimeInJst, timeInJst } from "../ui/jstTime";

// 応答の型は、サーバーと同じ定義（schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
type Results = ResponseOf<"GET /api/store/results">;
type ResultRow = Results["items"][number];
type Totals = Results["summary"]["today"];

const EMPTY_MESSAGE = "まだ実績がありません。オファーを公開すると、出た回数や受け取られた数がここに並びます。";

const END_LABELS: Record<ResultRow["endReason"], string> = {
  live: "公開中",
  stopped: "止めた",
  time_up: "時刻で終了",
  banned: "運営が停止",
};

/** 割合（分母が0なら「—」）。 */
const percentOf = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** 「出た → 受け取られた → 完了」の数と割合（行と合計で同じ形）。 */
const Funnel = ({ shown, received, completed }: { shown: number; received: number; completed: number }) => (
  <ol className="store-funnel">
    <li>
      <span className="store-funnel__label">結果に出た</span>
      <span>
        <strong>{shown}</strong>回
      </span>
    </li>
    <li>
      <span className="store-funnel__label">受け取られた</span>
      <span>
        <strong>{received}</strong>組 <span className="store-funnel__rate">{percentOf(received, shown)}</span>
      </span>
    </li>
    <li>
      <span className="store-funnel__label">完了</span>
      <span>
        <strong>{completed}</strong>組 <span className="store-funnel__rate">{percentOf(completed, received)}</span>
      </span>
    </li>
  </ol>
);

const TotalsCard = ({ title, totals }: { title: string; totals: Totals }) => (
  <section className="store-card store-results__total">
    <h2>
      {title}
      <span className="store-note">（公開 {totals.offers} 件・取り消し {totals.cancelled} 組）</span>
    </h2>
    <Funnel shown={totals.shown} received={totals.received} completed={totals.completed} />
  </section>
);

/** 見せたクーポン（消したものは名前を出せないので数で添える）。 */
const couponLabel = (item: ResultRow): string => {
  if (item.couponCount === 0) return "クーポンなし";
  const removed = item.couponCount - item.coupons.length;
  const names = item.coupons.join("・");
  if (removed === 0) return names;
  return names === "" ? `消したクーポン ${removed} つ` : `${names}・消したクーポン ${removed} つ`;
};

/** 公開した時刻〜終わった（終わる）時刻。 */
const spanLabel = (item: ResultRow): string => `${dateTimeInJst(item.publishedAt)}〜${timeInJst(item.endedAt ?? item.untilAt)}`;

/** 配信数（「追加で出す」で積み上がっていれば、最後の数も添える）。 */
const capacityLabel = (item: ResultRow): string =>
  item.capacity === item.initialCapacity ? `配信 ${item.initialCapacity}組` : `配信 ${item.initialCapacity}組（最後は ${item.capacity}組）`;

const ResultCard = ({ item }: { item: ResultRow }) => (
  <li className="store-card store-result" data-testid={`row-${item.offerId}`}>
    <div className="store-result__head">
      <span className="store-result__span">{spanLabel(item)}</span>
      <span className={`store-result__end store-result__end--${item.endReason}`}>{END_LABELS[item.endReason]}</span>
    </div>
    <p className="store-result__conditions">
      {capacityLabel(item)}・{item.partyMax}名まで・{couponLabel(item)}
    </p>
    <Funnel shown={item.shown} received={item.received} completed={item.completed} />
    <p className="store-note">
      取り消し {item.cancelled.total}（客 {item.cancelled.customer}・期限 {item.cancelled.expired}・店 {item.cancelled.store}・運営 {item.cancelled.admin}）
    </p>
  </li>
);

export const ResultsTable = () => {
  const [results, setResults] = useState<Results | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await callApi("GET /api/store/results");
      if (!alive) return;
      if (isFailure(result)) {
        setFailure(result);
        setResults(null);
        return;
      }
      setResults(result);
      setFailure(null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const items = results?.items ?? null;

  return (
    <main className="store-main">
      <StoreNav active="results" />
      <h1>実績</h1>

      <FormMessage failure={failure} />

      {/* 取れてから出す——取る前から「まだ実績がありません」を出すと、読めていないのか0件なのかが区別できない。 */}
      {items?.length === 0 && <p data-testid="results-empty">{EMPTY_MESSAGE}</p>}

      {results !== null && results.items.length > 0 && (
        <>
          <div className="store-results__totals" data-testid="results-summary">
            <TotalsCard title="今日" totals={results.summary.today} />
            <TotalsCard title="直近7日" totals={results.summary.week} />
          </div>
          <ul className="store-results">
            {results.items.map((item) => (
              <ResultCard key={item.offerId} item={item} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
};

export default ResultsTable;
