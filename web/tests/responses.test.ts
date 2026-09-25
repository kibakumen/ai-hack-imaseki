// 成功した応答の形の表（監査の指摘 設計-07・設計-09・2026-09-25）。
//   - JSON を返す入口は全部、表に形が載っている（載せ忘れた入口は、画面が形を確かめずに読む）
//   - 表の鍵は全部、実在する入口（綴りを間違えた鍵は、どの応答も確かめない）
//   - 画面の束に入るファイルは zod（大きい版）を値として読まない（約40言語の文言が画面の JS に入る）
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_DEFINITIONS } from "../lib/http/routes";
import { NON_JSON_ROUTES, RESPONSES } from "../lib/schemas/responses";

const WEB = path.resolve(__dirname, "..");

const sourcesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourcesUnder(p);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [p] : [];
  });

/** `import ... from "zod"`（値として。`import type` は除く）。 */
const importsFullZod = (text: string): boolean => /^\s*import\s+(?!type\s)[^'"]*from\s+['"]zod['"]/m.test(text);

describe("成功した応答の形の表", () => {
  const routeKeys = ROUTE_DEFINITIONS.map((r) => `${r.method} ${r.path}`);

  it("JSON を返す入口は全部、表に形が載っている", () => {
    const missing = routeKeys.filter((key) => !(NON_JSON_ROUTES as readonly string[]).includes(key) && !(key in RESPONSES));
    expect(missing).toEqual([]);
  });

  it("入口の成功は全部 respond（形の表で確かめる道）を通る。手で組んだ 2xx の本文が無い（ファイル・少しずつ届く本文を除く）", () => {
    const offenders = sourcesUnder(path.join(WEB, "lib", "http", "endpoints")).flatMap((f) =>
      (fs.readFileSync(f, "utf8").match(/status:\s*2\d\d,\s*body:(?!\s*null,\s*raw)[^\n]*/g) ?? []).map((m) => `${path.basename(f)}: ${m}`),
    );
    expect(offenders).toEqual([]);
  });

  it("表の鍵と、JSON でない入口の一覧は、全部が実在する入口で、重ならない", () => {
    expect(Object.keys(RESPONSES).filter((key) => !routeKeys.includes(key))).toEqual([]);
    expect(NON_JSON_ROUTES.filter((key) => !routeKeys.includes(key))).toEqual([]);
    expect(NON_JSON_ROUTES.filter((key) => key in RESPONSES)).toEqual([]);
  });
});

/** 値の写しから、点で区切った道筋（`items.0.createdAt`）の項目を1つ消す。 */
const without = (body: unknown, dotted: string): unknown => {
  const copy = structuredClone(body) as Record<string, unknown>;
  const keys = dotted.split(".");
  const last = keys.pop() as string;
  const parent = keys.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, copy);
  delete parent[last];
  return copy;
};

const COUPON_ROW = { id: "c1", name: "生ビール", note: "", createdAt: "2026-09-22T06:00:00.000Z" };
const ADMIN_ROW = {
  id: "s1",
  name: "店",
  address: null,
  email: null,
  status: "approved",
  publishing: false,
  createdAt: "2026-09-22T06:00:00.000Z",
  claims: 0,
  budgetMin: null,
  offerRemaining: null,
  changedSinceApproval: false,
  contacted: false,
  storeCancelled: 0,
  storeCancelRate: 0,
};

/**
 * サーバーが必ず送る項目（2026-09-25 レビューの指摘）。任意にしておくと、手続きの側で名前がずれても
 * 型検査（respond の本文は手続きの結果で、書き下ろした値ではないので余分な項目の検査に掛からない）も
 * 実行時の形の確かめも通り、画面は undefined を読む——設計-07 が問題にした形が残る。
 */
const ALWAYS_SENT: ReadonlyArray<{ route: keyof typeof RESPONSES; body: unknown; fields: string[] }> = [
  {
    route: "GET /api/customer/home",
    body: { kind: "fetch", profile: { nickname: "たなか", phone: "09012345678", genres: [], budgetMax: null } },
    fields: ["profile"],
  },
  {
    route: "GET /api/store/home",
    body: {
      id: "s1",
      status: "approved",
      checklist: { license: true, card: true },
      missingProfile: [],
      offer: null,
      publishPrefill: { couponIds: [], capacity: null, partyMax: null, until: null },
      coupons: [COUPON_ROW],
      arrivals: [],
      mustChangePassword: false,
    },
    fields: ["mustChangePassword", "coupons.0.createdAt"],
  },
  {
    route: "GET /api/store/profile",
    body: { ok: true, profile: { name: null, address: null, url: null, genres: [], menus: [], budgetMin: null, budgetMax: null } },
    fields: ["ok"],
  },
  { route: "GET /api/store/coupons", body: { ok: true, items: [COUPON_ROW] }, fields: ["ok", "items.0.createdAt"] },
  { route: "POST /api/store/coupons", body: { ok: true, coupon: COUPON_ROW }, fields: ["coupon.createdAt"] },
  { route: "PUT /api/store/coupons/:id", body: { ok: true, coupon: COUPON_ROW }, fields: ["coupon.createdAt"] },
  {
    route: "GET /api/admin/stores",
    body: { items: [ADMIN_ROW], summary: { publishing: 0, pending: 0, awaiting: 0, total: 1 } },
    fields: [
      "items.0.publishing",
      "items.0.createdAt",
      "items.0.claims",
      "items.0.budgetMin",
      "items.0.offerRemaining",
      "items.0.changedSinceApproval",
      "items.0.storeCancelled",
      "summary.awaiting",
      "summary.total",
    ],
  },
  {
    route: "GET /api/admin/stores/:id",
    body: {
      store: {
        ...ADMIN_ROW,
        url: null,
        genres: [],
        menus: [],
        budgetMax: null,
        license: false,
        cardRegistered: false,
        licenseUploadedAt: null,
        approval: null,
        changes: { name: false, address: false, license: false },
        activeReservations: 0,
        duplicates: 0,
        note: null,
        contactedAt: null,
      },
      reports: { count: 0, latest: [] },
      history: [],
    },
    fields: ["store.publishing", "store.createdAt", "store.claims", "store.offerRemaining", "store.activeReservations", "store.changes", "reports", "history"],
  },
];

describe("サーバーが必ず送る項目は、形の表でも必須", () => {
  it.each(ALWAYS_SENT)("$route の本文は、揃っていれば通り、1つでも欠ければ通らない", ({ route, body, fields }) => {
    const schema = RESPONSES[route];
    expect(schema.safeParse(body).success).toBe(true);
    const accepted = fields.filter((field) => schema.safeParse(without(body, field)).success);
    expect(accepted).toEqual([]);
  });
});

describe("画面の束に zod の大きい版を入れない（設計-09）", () => {
  it("components・app・lib/client・schemas/responses・domain/texts が zod を値として読まない（読むなら zod/mini から名前で）", () => {
    const files = [
      ...sourcesUnder(path.join(WEB, "components")),
      ...sourcesUnder(path.join(WEB, "app")).filter((f) => !f.includes(`${path.sep}api${path.sep}`)),
      ...sourcesUnder(path.join(WEB, "lib", "client")),
      path.join(WEB, "lib", "schemas", "responses.ts"),
      path.join(WEB, "lib", "schemas", "limits.ts"),
      path.join(WEB, "lib", "domain", "texts.ts"),
    ];
    const offenders = files.filter((f) => importsFullZod(fs.readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f));
    expect(offenders).toEqual([]);
  });

  it("zod/mini は名前を指定して読む（名前空間 `* as z` で読むと、文言の束ごと入りうる）", () => {
    const files = [...sourcesUnder(path.join(WEB, "lib", "client")), path.join(WEB, "lib", "schemas", "responses.ts")];
    const offenders = files.filter((f) => /import\s+\*\s+as\s+\w+\s+from\s+['"]zod\/mini['"]|import\s+\{\s*z\s*\}\s+from\s+['"]zod\/mini['"]/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
