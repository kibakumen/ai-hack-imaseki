// どの店の行からも指されていない営業許可書のファイルを消す掃除（2026-09-25 監査の指摘 安全-20 の案1 の残り・レビュー）。
//
// 許可書を消す手続き（上げ直し・取り下げ・止めたとき）は、置き場から消せなかったファイルを記録に残すだけで、
// 置き場には残っていた。店主の氏名と住所が載りうるので、どこからも指されなくなったファイルは消す。
//   - 上げている途中（置き場に置いた・表はまだ前の鍵）のファイルを消さないよう、置いてから1時間たったものだけを消す
//     （鍵に置いた時刻を入れる。時刻の無い古い形の鍵は、この直しより前に置いたもの＝十分に古い）
//   - 1日に1回まで（許可書の操作のあとに、応答を待たせずに走らせる）

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, cookieOf, makeCtx, one, PNG_BYTES, registerStore, seedAdmin, uploadLicense, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import { DOCUMENTS_TEXTS } from "../domain/texts";
import { PENDING_LICENSE_RETENTION_MS } from "../schemas/limits";
import type { Deps, FileStore } from "../ports";
import { runLicenseSweep } from "./licenseSweep";

let ctx: Ctx;
const HOUR_MS = 60 * 60 * 1000;

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

const filesOf = (storeId: string) => [...ctx.files.store.keys()].filter((key) => key.startsWith(`licenses/${storeId}/`)).sort();
const putFile = (key: string) => ctx.files.put(key, PNG_BYTES, "image/png");
const advance = (ms: number) => ctx.clock.set(new Date(ctx.clock.now().getTime() + ms).toISOString());

describe("指されていない許可書のファイルの掃除（安全-20）", () => {
  it("上げた許可書の鍵には置いた時刻が入る（掃除が、上げている途中のファイルを見分けるため）", async () => {
    const store = await approvedStore(ctx, { name: "鍵の形の店" });
    const [key] = filesOf(store.id);
    expect(key).toMatch(new RegExp(`^licenses/${store.id}/\\d{13}-`));
  });

  it("表から指されていない古いファイルと、時刻の無い古い形のファイルを消し、指されているファイルと置いたばかりのファイルは残す。1日に1回まで", async () => {
    const store = await approvedStore(ctx, { name: "掃除の店" });
    await uploadLicense(store.api, PNG_BYTES, "again.png", "image/png");
    const referenced = filesOf(store.id);
    expect(referenced).toHaveLength(2); // 今の分と承認の写し

    const now = ctx.clock.now().getTime();
    const orphan = `licenses/${store.id}/${now - 2 * HOUR_MS}-orphan`;
    const legacy = `licenses/${store.id}/legacytoken`;
    const fresh = `licenses/${store.id}/${now}-uploading`;
    await Promise.all([putFile(orphan), putFile(legacy), putFile(fresh)]);

    await runLicenseSweep(ctx.deps);
    expect(filesOf(store.id)).toEqual([...referenced, fresh].sort());
    expect(ctx.logger.entries).toContainEqual(expect.objectContaining({ event: "license_orphan_deleted", id: store.id }));

    // 同じ日のうちは走らない
    const another = `licenses/${store.id}/${now - 3 * HOUR_MS}-another`;
    await putFile(another);
    await runLicenseSweep(ctx.deps);
    expect(filesOf(store.id)).toContain(another);

    // 1日たてば、置いてから1時間を過ぎた分（さっきは置いたばかりだったものも）を消す
    advance(25 * HOUR_MS);
    await runLicenseSweep(ctx.deps);
    expect(filesOf(store.id)).toEqual(referenced);
  });

  it("置き場が一覧を出せない（list の無い）口では、指されていないファイルの掃除をしない", async () => {
    const files = ctx.deps.files as FileStore;
    const withoutList: FileStore = { put: files.put, get: files.get, delete: files.delete };
    // 前の検査で時計が進み、運営のセッションが切れている。入り直してから承認する
    await seedAdmin(ctx);
    const store = await approvedStore(ctx, { name: "一覧の無い店" });
    const orphan = `licenses/${store.id}/${ctx.clock.now().getTime() - 2 * HOUR_MS}-orphan`;
    await putFile(orphan);
    advance(25 * HOUR_MS);
    await expect(runLicenseSweep({ ...ctx.deps, files: withoutList } as Deps)).resolves.toBeUndefined();
    expect(filesOf(store.id)).toContain(orphan);
  });
});

// 2026-09-26 のレビュー（安全-20 の案1 の残り）: 承認を断る操作は置かない（要件25の基準 25.3）ので、運営が承認しないまま
// 置いた店の許可書は、店が自分で取り下げない限り期限なく残り、運営の画面から開けた。案1 の「承認の審査が終わったときに消す」を、
// 上げてから30日たっても承認されなければ審査は終わったものとして消す、の形で置く（AI判断）。
describe("承認されないまま置かれた許可書の保管期限（安全-20）", () => {
  const DAY_MS = 24 * HOUR_MS;
  const licenseKeyOf = async (storeId: string) => (await one<{ license_key: string | null }>(ctx.db, "SELECT license_key FROM stores WHERE id = ?", storeId))!.license_key;

  it("上げてから30日たっても承認されない店の許可書は、表から外してファイルを消す。30日に満たない店と承認済みの店は残す。一覧の無い口でも消す", async () => {
    advance(2 * DAY_MS);
    const stale = await registerStore(ctx);
    expect((await uploadLicense(stale.api, PNG_BYTES, "stale.png", "image/png")).status).toBeLessThan(300);
    await seedAdmin(ctx);
    const approved = await approvedStore(ctx, { name: "承認済みの古い店" });
    advance(PENDING_LICENSE_RETENTION_MS - DAY_MS);
    const recent = await registerStore(ctx);
    expect((await uploadLicense(recent.api, PNG_BYTES, "recent.png", "image/png")).status).toBeLessThan(300);
    advance(2 * DAY_MS);

    const files = ctx.deps.files as FileStore;
    const withoutList: FileStore = { put: files.put, get: files.get, delete: files.delete };
    await runLicenseSweep({ ...ctx.deps, files: withoutList } as Deps);

    expect(await licenseKeyOf(stale.id)).toBeNull();
    expect(filesOf(stale.id)).toEqual([]);
    expect(await licenseKeyOf(recent.id)).not.toBeNull();
    expect(filesOf(recent.id)).toHaveLength(1);
    expect(await licenseKeyOf(approved.id)).not.toBeNull();
    expect(filesOf(approved.id).length).toBeGreaterThan(0);
    expect(ctx.logger.entries).toContainEqual(expect.objectContaining({ event: "license_expired_unapproved", id: stale.id }));
    // 店のホームは許可書が無い（上げ直せば、また審査に入る）。30日たって店のセッションは切れているので入り直して見る
    const relogin = await ctx.api().post("/api/auth/login", { email: stale.email, password: stale.password, humanToken: "tok-ok" });
    expect((await ctx.api(cookieOf(relogin)).get("/api/store/home")).json.checklist.license).toBe(false);
  });

  it("書類の画面の説明は、保管の期限の日数を実装と同じ値で書く", () => {
    expect(DOCUMENTS_TEXTS.licenseRetention).toContain(`${PENDING_LICENSE_RETENTION_MS / (24 * HOUR_MS)}日`);
  });
});
