// 紹介文の層（生成 → 決定論のガード → 別ベンダーの検査官 → 2回で諦める）。
// 外へは1バイトも出さず、差し替え口 PitchWriter を偽物にして筋だけを見る。
import { describe, expect, it } from "vitest";
import { writePitch, type PitchTarget } from "./writePitch";
import type { Deps, PitchResult } from "../ports";

const STORE = { name: "海鮮どんぶり亭", genres: ["和食"], menus: ["刺身盛り"], walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, couponName: "生ビール1杯", couponNote: "1組1回" };
const TARGET: PitchTarget = { storeId: "store-1", store: STORE, selectionReason: "近くて好みに合います" };

const ok = (text: string): PitchResult => ({ ok: true, text, costUsd: 0.0001, truncated: false, resolvedModel: "google/gemini-2.5-flash", requestId: "req-1", fallbackLevel: 0 });

type Row = Record<string, unknown>;

/** 記録だけを覚える偽の D1（手続きが書いた1行を後から読む） */
const fakeDb = (rows: Row[]) => ({
  prepare: (sql: string) => ({
    bind: (...values: unknown[]) => ({
      run: async () => {
        rows.push({ sql, values });
      },
    }),
  }),
  batch: async () => [],
});

const makeDeps = (pitch: Deps["pitch"], rows: Row[] = []): { deps: Deps; rows: Row[] } => {
  const deps = {
    db: fakeDb(rows),
    pitch,
    logger: { log: () => {} },
    clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) },
    rng: { bytes: (n: number) => new Uint8Array(n).fill(7) },
  } as unknown as Deps;
  return { deps, rows };
};

const purposesOf = (rows: Row[]): string[] => rows.map((r) => (r.values as unknown[])[2] as string);

describe("紹介文の層", () => {
  it("1回で通れば人格つきの文を返し、生成と検査の2行が用途つきで残る", async () => {
    const { deps, rows } = makeDeps({
      write: async () => ok("刺身盛りが自慢の一軒です"),
      judge: async () => ok('{"ok":true,"reason":""}'),
    });
    const written = await writePitch(deps, { fetchId: "f1", party: 2, genres: ["和食"], budgetMax: 4000, target: TARGET });
    expect(written).toEqual({ storeId: "store-1", reason: "刺身盛りが自慢の一軒です", source: "persona" });
    expect(purposesOf(rows)).toEqual(["pitch", "pitch_eval"]);
  });

  it("決定論のガードに落ちた案は検査官へ送らず、書き直しの理由を渡して2回目を頼む", async () => {
    const seen: Array<string | null> = [];
    const texts = ["口コミでも人気の店です", "焼きたての香りが心地よい一軒です"];
    const { deps, rows } = makeDeps({
      write: async (input) => {
        seen.push(input.critique);
        return ok(texts[seen.length - 1]);
      },
      judge: async () => ok('{"ok":true,"reason":""}'),
    });
    const written = await writePitch(deps, { fetchId: "f1", party: 2, genres: [], budgetMax: null, target: TARGET });
    expect(written.source).toBe("persona");
    expect(written.reason).toBe("焼きたての香りが心地よい一軒です");
    expect(seen[0]).toBeNull();
    expect(seen[1]).toContain("口コミ");
    // 1回目は検査官を呼ばない（決定論で落ちたので聞くまでもない）
    expect(purposesOf(rows)).toEqual(["pitch", "pitch", "pitch_eval"]);
    // 決定論で落とした呼び出しは「検査に落ちた」として残る
    expect((rows[0].values as unknown[])[6]).toBe(1);
  });

  it("検査官が不合格にし続けたら、選定の理由へ倒す（客の画面に穴を残さない）", async () => {
    const { deps } = makeDeps({
      write: async () => ok("焼きたての香りが心地よい一軒です"),
      judge: async () => ok('{"ok":false,"reason":"渡していない設備に触れている"}'),
    });
    const written = await writePitch(deps, { fetchId: "f1", party: 2, genres: [], budgetMax: null, target: TARGET });
    expect(written).toEqual({ storeId: "store-1", reason: "近くて好みに合います", source: "fallback" });
  });

  it("上限で切れた文（truncated）は字数を満たしていても落とす", async () => {
    const { deps } = makeDeps({
      write: async () => ({ ok: true, text: "刺身盛りが自慢で、名物の", costUsd: 0.0001, truncated: true }),
      judge: async () => ok('{"ok":true,"reason":""}'),
    });
    const written = await writePitch(deps, { fetchId: "f1", party: 2, genres: [], budgetMax: null, target: TARGET });
    expect(written.source).toBe("fallback");
  });

  it("口が失敗し続けても例外を外へ出さず、決まった文へ倒す", async () => {
    const { deps } = makeDeps({
      write: async () => ({ ok: false, error: "network" }),
      judge: async () => ({ ok: false, error: "network" }),
    });
    const written = await writePitch(deps, { fetchId: "f1", party: 2, genres: [], budgetMax: null, target: { ...TARGET, selectionReason: "" } });
    expect(written).toEqual({ storeId: "store-1", reason: "生ビール1杯が使えます", source: "fallback" });
  });

  it("紹介文の口が無い場面（受け入れ検査）では層ごと走らず、記録も1行も増えない", async () => {
    const { deps, rows } = makeDeps(undefined);
    const written = await writePitch(deps, { fetchId: "f1", party: 2, genres: [], budgetMax: null, target: TARGET });
    expect(written).toEqual({ storeId: "store-1", reason: "近くて好みに合います", source: "fallback" });
    expect(rows).toEqual([]);
  });
});
