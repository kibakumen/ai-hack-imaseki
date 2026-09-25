// 少しずつ届ける取得（NDJSON）。店の選定は偽の口で済ませ、行の並びと打ち止めだけを見る。
import { describe, expect, it, vi } from "vitest";
import type { Deps, PitchResult } from "../ports";

/** 取得の手続きを偽物にして、この層（配信）だけを見る */
vi.mock("./fetchOffers", () => ({
  fetchOffers: async () => ({
    ok: true,
    fetchId: "fetch-1",
    items: [{ offerId: "offer-1", storeId: "store-1", storeName: "海鮮どんぶり亭", walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "近くて好みに合います", partyMax: 4, coupons: [], storeUrl: null, storeAddress: null }],
    pitchTargets: [
      {
        storeId: "store-1",
        store: { name: "海鮮どんぶり亭", genres: ["和食"], menus: ["刺身盛り"], walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, couponName: null, couponNote: null },
        selectionReason: "近くて好みに合います",
      },
    ],
  }),
}));

const { buildOffersStream } = await import("./streamOffers");

const ok = (text: string): PitchResult => ({ ok: true, text, costUsd: 0.0001, truncated: false });

const makeDeps = (pitch: Deps["pitch"]): Deps =>
  ({
    // 読むのはその日の AI の呼び出しの合計だけ（安全-03 のアプリ全体の上限）。0回・0ドル＝まだ呼べる
    db: { prepare: () => ({ bind: () => ({ run: async () => {}, first: async () => ({ calls: 0, cost: 0 }) }) }), batch: async () => [] },
    pitch,
    logger: { log: () => {} },
    // 打ち切りの合図は鳴らさない（この検査で見たいのは行の並びで、時間切れの筋ではない）
    clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) },
    rng: { bytes: (n: number) => new Uint8Array(n).fill(3) },
  }) as unknown as Deps;

const readLines = async (stream: ReadableStream<Uint8Array>): Promise<Array<Record<string, unknown>>> => {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe("少しずつ届ける取得", () => {
  it("店のカードを先に出し、紹介文を1店1行だけ足して打ち止める", async () => {
    const result = await buildOffersStream(makeDeps({ write: async () => ok("歩いて4分、今日は刺身盛りを出してるよ"), judge: async () => ok('{"ok":true,"reason":""}') }), "c1", { party: 2 });
    expect(result.ok).toBe(true);
    const lines = result.ok ? await readLines(result.stream) : [];
    expect(lines.map((l) => l.type)).toEqual(["init", "pitch", "done"]);
    expect(lines[0]).toMatchObject({ fetchId: "fetch-1" });
    expect((lines[0].items as unknown[]).length).toBe(1);
    expect(lines[1]).toEqual({ type: "pitch", storeId: "store-1", reason: "歩いて4分、今日は刺身盛りを出してるよ", source: "persona" });
  });

  it("紹介文の口が無い場面では、選定の理由をそのまま1行ずつ出して閉じる", async () => {
    const result = await buildOffersStream(makeDeps(undefined), "c1", { party: 2 });
    const lines = result.ok ? await readLines(result.stream) : [];
    expect(lines.map((l) => l.type)).toEqual(["init", "pitch", "done"]);
    expect(lines[1]).toEqual({ type: "pitch", storeId: "store-1", reason: "近くて好みに合います", source: "fallback" });
  });

  it("紹介文が決定論のガードに2回落ちたら、書き手の本文は客へ出さず、選定の理由（決まった文）へ倒れる", async () => {
    // 以前はこの検査の名前が「選定の出力の検査」で、中身は自分の定数を確かめていただけだった（設計-04）
    const result = await buildOffersStream(makeDeps({ write: async () => ok("口コミでも人気です"), judge: async () => ok('{"ok":true,"reason":""}') }), "c1", { party: 2 });
    const lines = result.ok ? await readLines(result.stream) : [];
    // 決定論のガードに2回落ちるので、決まった文へ倒れる
    expect(lines[1]).toMatchObject({ source: "fallback", reason: "近くて好みに合います" });
    expect(JSON.stringify(lines)).not.toContain("口コミ");
  });
});

// ---------- 応答のあとも紹介文の仕事を生かす口（設計-17）と、客が閉じたら AI を止める（設計-18） ----------

type Recorded = { sql: string; values: unknown[] };

/** 書き込みを覚える D1・合図を検査が鳴らせる時計・預けた仕事を覚える defer を持つ Deps */
const makeWatchedDeps = (pitch: Deps["pitch"], opts: { budgetFiresAt?: Promise<void> } = {}) => {
  const recorded: Recorded[] = [];
  const deferred: Array<Promise<unknown>> = [];
  const deps = {
    db: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            recorded.push({ sql, values });
          },
          first: async () => ({ calls: 0, cost: 0 }),
        }),
      }),
      batch: async () => [],
    },
    pitch,
    logger: { log: () => {} },
    // 全体の蓋（25秒）だけを検査が鳴らす。ほかの合図（着手のずらし・1回の打ち切り）は鳴らさない
    clock: {
      now: () => new Date("2026-09-22T06:00:00.000Z"),
      after: (ms: number) => (ms === 25_000 && opts.budgetFiresAt ? opts.budgetFiresAt : ms <= 1_000 ? Promise.resolve() : new Promise<void>(() => {})),
    },
    rng: { bytes: (n: number) => new Uint8Array(n).fill(3) },
    defer: (task: Promise<unknown>) => {
      deferred.push(task);
    },
  } as unknown as Deps;
  return { deps, recorded, deferred };
};

const aiCallPurposes = (recorded: Recorded[]): string[] => recorded.filter((r) => /INSERT INTO ai_calls/.test(r.sql)).map((r) => r.values[2] as string);

describe("応答を閉じたあとの紹介文の仕事（設計-17）", () => {
  it("全体の蓋が先に来て応答を閉じても、紹介文の仕事は defer に預けられ、書き手と検査官の記録が最後まで揃う", async () => {
    let fireBudget: () => void = () => {};
    const budgetFiresAt = new Promise<void>((resolve) => {
      fireBudget = resolve;
    });
    let releaseWrite: () => void = () => {};
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const { deps, recorded, deferred } = makeWatchedDeps(
      {
        write: async () => {
          await writeHeld;
          return ok("歩いて4分、今日は刺身盛りを出してるよ");
        },
        judge: async () => ok('{"ok":true,"reason":""}'),
      },
      { budgetFiresAt },
    );
    const result = await buildOffersStream(deps, "c1", { party: 2 });
    const reading = result.ok ? readLines(result.stream) : Promise.resolve([]);
    // 蓋が先に鳴る → まだ届いていない店は決まった文で確定して閉じる
    fireBudget();
    const lines = await reading;
    expect(lines.map((l) => l.type)).toEqual(["init", "pitch", "done"]);
    expect(lines[1]).toMatchObject({ source: "fallback" });
    // 応答を閉じた時点では、紹介文の記録はまだ無い
    expect(aiCallPurposes(recorded)).toEqual([]);
    // 紹介文の仕事は defer に預けてある（本番は ctx.waitUntil。預けないと応答を閉じた時点で Worker が切る）
    expect(deferred).toHaveLength(1);
    releaseWrite();
    await deferred[0];
    expect(aiCallPurposes(recorded)).toEqual(["pitch", "pitch_eval"]);
  });

  it("defer の口が無い場面（受け入れ検査・next dev の外）でも、行の並びは変わらない", async () => {
    const result = await buildOffersStream(makeDeps({ write: async () => ok("歩いて4分だよ"), judge: async () => ok('{"ok":true,"reason":""}') }), "c1", { party: 2 });
    const lines = result.ok ? await readLines(result.stream) : [];
    expect(lines.map((l) => l.type)).toEqual(["init", "pitch", "done"]);
  });
});

describe("客が閉じたら紹介文の AI を止める（設計-18）", () => {
  /** 書き手は打ち切りの合図が来るまで返らない。呼ばれた回数と、合図を受けた回数を数える */
  const hangingWriter = () => {
    const seen = { writes: 0, aborted: 0, judges: 0 };
    const pitch: Deps["pitch"] = {
      write: (_input, opts) => {
        seen.writes++;
        return new Promise<PitchResult>((resolve) => {
          opts.signal?.addEventListener("abort", () => {
            seen.aborted++;
            resolve({ ok: false, error: "aborted" });
          });
        });
      },
      judge: async () => {
        seen.judges++;
        return ok('{"ok":true,"reason":""}');
      },
    };
    return { pitch, seen };
  };

  it("読み手がストリームを閉じると、書きかけの書き手へ打ち切りが届き、書き直しも検査官も呼ばない。閉じた後に例外は出ない", async () => {
    const { pitch, seen } = hangingWriter();
    const { deps, deferred } = makeWatchedDeps(pitch);
    const result = await buildOffersStream(deps, "c1", { party: 2 });
    if (!result.ok) throw new Error("ストリームが開きませんでした");
    const reader = result.stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"type":"init"');
    // 書き手が呼ばれるまで待ってから閉じる
    for (let i = 0; i < 50 && seen.writes === 0; i++) await new Promise((r) => setTimeout(r, 1));
    expect(seen.writes).toBe(1);
    await reader.cancel();
    await deferred[0];
    expect(seen.aborted).toBe(1);
    // 2回目の書き手（書き直し）も検査官も呼ばれていない
    expect(seen.writes).toBe(1);
    expect(seen.judges).toBe(0);
  });

  it("要求の打ち切りの合図（客の切断）が鳴っても、書きかけの書き手へ打ち切りが届く", async () => {
    const { pitch, seen } = hangingWriter();
    const { deps, deferred } = makeWatchedDeps(pitch);
    const disconnected = new AbortController();
    const result = await buildOffersStream(deps, "c1", { party: 2 }, { signal: disconnected.signal });
    if (!result.ok) throw new Error("ストリームが開きませんでした");
    const reading = readLines(result.stream);
    for (let i = 0; i < 50 && seen.writes === 0; i++) await new Promise((r) => setTimeout(r, 1));
    disconnected.abort();
    await deferred[0];
    expect(seen.aborted).toBe(1);
    expect(seen.writes).toBe(1);
    // 切断のあとは、決まった文で閉じる（読み手が残っていれば、画面に穴は残さない）
    const lines = await reading;
    expect(lines.at(-1)).toMatchObject({ type: "done" });
  });
});
