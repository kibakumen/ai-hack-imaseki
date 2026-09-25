// 検査の道具（tests/acceptance/v2/_fakes.ts）そのものの検査（2026-09-25 設計-19・設計-03）。
// 道具が約束どおりに効かないと、それを使う検査は「実時間の打ち切りで緑」「近道で緑」になり、何も示さなくなる。
import { describe, expect, expectTypeOf, it } from "vitest";
import { fakeCard, fakeClock, fakeGeocoder, isFake, makeCtx, splitSql, type FakeAi, type FakeGeocoder } from "../../tests/acceptance/v2/_fakes";

describe("偽の時計", () => {
  it("armed は、これから作られる合図を待ってから解ける（要求を送った直後に進めても合図を取りこぼさない）", async () => {
    const clock = fakeClock();
    const armed = clock.armed(1);
    let fired = false;
    // 要求の中で、少し遅れて合図を作る手続きのつもり
    setTimeout(() => void clock.after(3_000).then(() => (fired = true)), 5);
    await armed;
    await clock.advance(3_100);
    expect(fired).toBe(true);
  });

  it("armed は、合図が作られなければ理由つきで落ちる（黙って待ち続けない）", async () => {
    const clock = fakeClock();
    await expect(clock.armed(1, 20)).rejects.toThrow(/合図/);
  });
});

describe("migration を文に分ける道具", () => {
  it("行の注を落とし、文字列の中とトリガーの本文の中の ; では切らない", () => {
    const sql = [
      "-- 注; ここは消える",
      "CREATE TABLE a (id TEXT, note TEXT DEFAULT 'x;y');",
      "CREATE TRIGGER t AFTER INSERT ON a BEGIN",
      "  UPDATE a SET note = CASE WHEN note = '' THEN 'z' ELSE note END;",
      "  DELETE FROM a WHERE id IS NULL;",
      "END;",
      "CREATE INDEX i ON a(id);",
    ].join("\n");
    const out = splitSql(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("'x;y'");
    expect(out[1]).toMatch(/^CREATE TRIGGER[\s\S]*END$/);
    expect(out[2]).toBe("CREATE INDEX i ON a(id)");
    expect(out.join("\n")).not.toContain("注");
  });
});

describe("偽のカードの口", () => {
  it("移り先の URL は番号で終わらず、入力を終えるまで確かめは通らず、戻り先の {CHECKOUT_SESSION_ID} だけが番号で埋まる", async () => {
    const card = fakeCard();
    const plain = await card.createSetupSession({ storeId: "s1", returnUrl: "https://app.test/store/documents" });
    if (!plain.ok) throw new Error("setup failed");
    expect(plain.url.split("/").pop()).not.toBe(plain.sessionId);
    expect(plain.url).not.toContain(plain.sessionId);
    expect(await card.confirmSetup(plain.sessionId)).toEqual({ ok: false });
    expect(card.complete(plain.url)).toBe("https://app.test/store/documents");
    expect(await card.confirmSetup(plain.sessionId)).toEqual({ ok: true, clientReference: "s1" });

    const templated = await card.createSetupSession({ storeId: "s2", returnUrl: "https://app.test/store/documents?session_id={CHECKOUT_SESSION_ID}" });
    if (!templated.ok) throw new Error("setup failed");
    expect(card.complete(templated.url)).toBe(`https://app.test/store/documents?session_id=${templated.sessionId}`);
  });
});

describe("場面の偽物の道具（ctx.<名前>）", () => {
  // 2026-09-25 設計-02 のレビュー: 以前は差し替え口を偽物でない物に替えても ctx.logger が型の上だけ FakeLogger で、
  // `.entries` が実行時に黙って undefined だった（d01 の both がこの形）。
  it("偽物でない物に替えた口は、型の上でも実行時にも道具が無い。替えなかった口は親と同じ偽物", async () => {
    const ctx = await makeCtx();
    try {
      const both = { log: (entry: Parameters<typeof ctx.logger.log>[0]) => void ctx.logger.log(entry) };
      const next = await ctx.withDeps({ logger: both });
      expectTypeOf(next.logger).toEqualTypeOf<undefined>();
      expect(next.logger).toBeUndefined();
      expect(next.deps.logger).toBe(both);
      expectTypeOf(next.ai).toEqualTypeOf<FakeAi>();
      expect(next.ai).toBe(ctx.ai);
      expect(isFake(next.ai)).toBe(true);

      const swapped = await next.withDeps({ geocoder: fakeGeocoder({ suggest: false }) });
      expectTypeOf(swapped.geocoder).toEqualTypeOf<FakeGeocoder>();
      expect(swapped.geocoder).toBe(swapped.deps.geocoder);
      expect(isFake(swapped.geocoder)).toBe(true);
      // 孫の場面でも、親で偽物でない物に替えた口は道具が無いまま
      expectTypeOf(swapped.logger).toEqualTypeOf<undefined>();
      expect(swapped.logger).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });

  it("偽物を広げて写した物は偽物と見なさない（道具の控えが元の偽物と食い違うため）", () => {
    const g = fakeGeocoder();
    expect(isFake(g)).toBe(true);
    expect(isFake({ ...g })).toBe(false);
  });
});
