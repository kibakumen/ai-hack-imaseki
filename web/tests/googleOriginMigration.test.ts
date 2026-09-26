// migration 0016: 取得の記録の起点から、Google から得た座標を外す（2026-09-26 本人選択・Service Specific Terms 6.3.1）。
//
// 記録の表を「追加だけ」とする基準 27.7 の、1回だけの例外。既にある行のうち、打った場所で探した行（Google で直した座標）と
// どちらで探したか分からない行（0006 より前）の座標を消し、現在地で探した行（端末の座標）は残す。列は空を許す形にする。
// 表を作り直すので、外部の鍵で指している子の表（fetch_items・selections・ai_calls）と索引が壊れていないことも見る。
//
// 本番の `wrangler d1 migrations apply` は1つのファイルを1つのまとまり（トランザクション）で流すので、ここも
// `db.batch` で1つのまとまりとして流す（`PRAGMA defer_foreign_keys` が効くのは、そのまとまりの終わりまで）。

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, rows, splitSql, WEB, type Db } from "../../tests/acceptance/v2/_fakes";

const MIGRATION = "0016_fetch_origin_without_google_coordinates.sql";

const seedLog = async (db: Db, input: { id: string; kind: "here" | "place" | null; lat: number; lng: number }): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at, origin_kind)
       VALUES (?1, 'customer-1', ?2, ?3, 2, '["和食"]', 3000, 4, 3, 1, 120, '2026-09-20T10:00:00.000Z', ?4)`,
    )
    .bind(input.id, input.lat, input.lng, input.kind)
    .run();
};

describe("migration 0016（取得の記録の起点から Google の座標を外す）", () => {
  let db: Db;
  let dispose: () => Promise<void>;
  let childrenBefore: Record<string, unknown[]>;
  let logsBefore: Array<Record<string, unknown>>;

  beforeAll(async () => {
    ({ db, dispose } = await openDb({ before: MIGRATION }));
    await db.prepare("INSERT INTO stores (id, name, status) VALUES ('store-1', '記録の店', 'approved')").run();
    await seedLog(db, { id: "log-here", kind: "here", lat: 35.6595, lng: 139.7005 });
    await seedLog(db, { id: "log-place", kind: "place", lat: 35.6896, lng: 139.7006 });
    await seedLog(db, { id: "log-unknown", kind: null, lat: 35.681, lng: 139.767 });
    for (const log of ["log-here", "log-place", "log-unknown"]) {
      await db.prepare("INSERT INTO fetch_items (id, fetch_id, store_id, rank, score, reason) VALUES (?1, ?2, 'store-1', 1, 0.9, '近い')").bind(`item-${log}`, log).run();
      await db.prepare("INSERT INTO ai_calls (id, fetch_id, duration_ms, succeeded, at) VALUES (?1, ?2, 100, 1, '2026-09-20T10:00:00.000Z')").bind(`ai-${log}`, log).run();
    }
    await db.prepare("INSERT INTO selections (id, fetch_id, store_id, at) VALUES ('sel-1', 'log-place', 'store-1', '2026-09-20T10:01:00.000Z')").run();
    childrenBefore = {};
    for (const t of ["fetch_items", "selections", "ai_calls"]) childrenBefore[t] = await rows(db, `SELECT * FROM ${t} ORDER BY rowid`);
    logsBefore = await rows(db, "SELECT * FROM fetch_logs ORDER BY id");

    const sql = fs.readFileSync(path.join(WEB, "migrations", MIGRATION), "utf8");
    await db.batch(splitSql(sql).map((statement) => db.prepare(statement)));
  });
  afterAll(async () => {
    await dispose();
  });

  it("打った場所で探した行と、どちらで探したか分からない行の座標を消し、現在地で探した行の座標は残す", async () => {
    const after = await rows(db, "SELECT id, origin_kind, origin_lat, origin_lng, origin_place, origin_place_id FROM fetch_logs ORDER BY id");
    expect(after).toEqual([
      { id: "log-here", origin_kind: "here", origin_lat: 35.6595, origin_lng: 139.7005, origin_place: null, origin_place_id: null },
      { id: "log-place", origin_kind: "place", origin_lat: null, origin_lng: null, origin_place: null, origin_place_id: null },
      { id: "log-unknown", origin_kind: null, origin_lat: null, origin_lng: null, origin_place: null, origin_place_id: null },
    ]);
  });

  it("座標のほかの列は1つも変わらない（行の数も同じ）", async () => {
    const ORIGIN_COLUMNS = new Set(["origin_lat", "origin_lng", "origin_place", "origin_place_id"]);
    const strip = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([column]) => !ORIGIN_COLUMNS.has(column)));
    const after = await rows(db, "SELECT * FROM fetch_logs ORDER BY id");
    expect(after.map(strip)).toEqual(logsBefore.map(strip));
  });

  it("外部の鍵で指している子の表の行はそのまま残り、指す先も fetch_logs のまま（外部の鍵の違反が無い）", async () => {
    for (const t of ["fetch_items", "selections", "ai_calls"]) {
      expect(await rows(db, `SELECT * FROM ${t} ORDER BY rowid`), t).toEqual(childrenBefore[t]);
      const keys = await rows<{ table: string; from: string }>(db, `PRAGMA foreign_key_list(${t})`);
      expect(keys.find((k) => k.from === "fetch_id")?.table, t).toBe("fetch_logs");
    }
    expect(await rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("外部の鍵は作り直したあとも効く（無い取得を指す行は入らない）", async () => {
    await expect(
      db.prepare("INSERT INTO fetch_items (id, fetch_id, store_id, rank, score, reason) VALUES ('item-orphan', 'no-such-log', 'store-1', 1, 0.5, '')").run(),
    ).rejects.toThrow();
  });

  it("座標は空を許し、打った文字と place ID を書ける。起点の種類の決まり（here／place）は残る。索引も作り直してある", async () => {
    await db
      .prepare(
        `INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at, origin_kind, origin_place, origin_place_id)
         VALUES ('log-new', 'customer-2', NULL, NULL, 2, '[]', NULL, 0, 0, 0, 10, '2026-09-26T10:00:00.000Z', 'place', '渋谷駅', 'ChIJ-shibuya')`,
      )
      .run();
    expect(await rows(db, "SELECT origin_place, origin_place_id FROM fetch_logs WHERE id = 'log-new'")).toEqual([{ origin_place: "渋谷駅", origin_place_id: "ChIJ-shibuya" }]);
    await expect(
      db
        .prepare(
          `INSERT INTO fetch_logs (id, customer_id, party, genres, candidate_count, returned_count, ai_used, duration_ms, at, origin_kind)
           VALUES ('log-bad-kind', 'customer-2', 2, '[]', 0, 0, 0, 10, '2026-09-26T10:00:00.000Z', 'elsewhere')`,
        )
        .run(),
    ).rejects.toThrow();
    const indexes = await rows<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'fetch_logs'");
    expect(indexes.map((i) => i.name)).toContain("idx_fetch_logs_customer_at");
  });
});
