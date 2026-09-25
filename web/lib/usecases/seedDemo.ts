// デモの種データの投入（web/scripts/seed-demo.mjs の中身）。運営1人・承認済みの店・クーポン・公開中のオファーを入れる。
//
// 2026-09-25（監査の指摘 安全-01 のレビュー）: 判断をスクリプト（.mjs・型の検査を通らない）からここへ移した。
//   - 運営は seedAdmin を「2人目を作らない」既定で呼ぶ（seed-admin.mjs と揃える）。別のメールアドレスの運営がいれば
//     OtherAdminsExistError で止まり、何も書かない。番号（admin.accountId）を指せば、変えられたメールアドレスごと取り返す。
//     それまでは既定のまま（2人目を作ってよい）呼んでいたので、乗っ取られたデモを作り直しても2人目の運営ができるだけだった
//   - 既にある店のアカウントは、パスワードを入れ替え、仮のパスワードの印を外し、そのアカウントのセッションを全部切る。
//     それまでは触れなかったので、締め出されたデモ店を作り直しで取り返せなかった
//   - 止められた店は承認済みへ戻す（「承認は毎回当て直す」が、止められた店には効いていなかった）
//   - スクリプトは repo から消えた関数（設計-14 で名前が変わった）を呼んで落ちていた。ここに置けば型の検査が見る

import type { Deps } from "../ports";
import { tokenFromBytes } from "../domain/token";
import { JST_OFFSET_MINUTES } from "../domain/until";
import { findAccountByEmail, updateAccountPassword, updateStorePasswordsByEmail } from "../repo/accounts";
import { approvePendingStore, findStoreReview, restoreBannedStore } from "../repo/adminStoreActions";
import { insertCouponWithinLimit, listCoupons } from "../repo/coupons";
import { insertOfferIfNone } from "../repo/offers";
import { deleteSessionsByAccount, deleteSessionsOfStoreAccountsByEmail } from "../repo/sessions";
import { insertStoreWithAccount, updateStoreProfile } from "../repo/stores";
import { COUPON_MAX, ID_BYTES, PASSWORD_MIN } from "../schemas/limits";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { hashPassword } from "./credentials";
import { seedAdmin, type SeedAdminInput, type SeedAdminResult } from "./seedAdmin";

export type DemoStoreSpec = {
  email: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** lib/domain/genres.ts の値だけ */
  genres: string[];
  menus: string[];
  budgetMin: number;
  budgetMax: number;
  offer: { capacity: number; partyMax: number };
  coupons: ReadonlyArray<{ name: string; note?: string }>;
};

export type SeedDemoInput = {
  /** 運営。`allowAnotherAdmin` を渡さなければ false（別のメールアドレスの運営がいるのに2人目を作らない） */
  admin: SeedAdminInput;
  /** デモ店に共通のパスワード */
  storePassword: string;
  stores: readonly DemoStoreSpec[];
};

export type DemoStoreResult = { email: string; storeId: string; created: boolean; couponCount: number; offerInserted: boolean };

export type SeedDemoResult = { admin: SeedAdminResult; stores: DemoStoreResult[] };

const CLOSING_HOUR_JST = 23;
const JST_OFFSET_MS = JST_OFFSET_MINUTES * 60 * 1000;

/** 「今」から見た、当日23:00（日本時間）。デモのオファーの受付の終わり。 */
export const demoClosingTime = (now: Date): Date => {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), CLOSING_HOUR_JST) - JST_OFFSET_MS);
};

const newId = (deps: Deps): string => tokenFromBytes(deps.rng.bytes(ID_BYTES));

/** 店とそのアカウントを用意する。既にあれば、パスワードを入れ替えてそのアカウントのセッションを全部切る。 */
const ensureStoreAccount = async (deps: Deps, spec: DemoStoreSpec, passwordHash: string): Promise<{ storeId: string; created: boolean }> => {
  const existing = await findAccountByEmail(deps.db, spec.email);
  if (!existing) {
    const storeId = newId(deps);
    await insertStoreWithAccount(deps.db, {
      store: { id: storeId, name: spec.name, createdAtIso: deps.clock.now().toISOString() },
      account: { id: newId(deps), email: spec.email, role: "store", storeId, passwordHash },
    });
    return { storeId, created: true };
  }
  // 運営のアカウントを店に変えない（1つのメールアドレスが指すアカウントは常に1つ・基準 12.2）。
  if (existing.role !== "store" || !existing.storeId) throw new Error(`${spec.email} は店のアカウントに使われていません`);
  // 入れ替えてから切る（先に切ると、入れ替えまでの間に古いパスワードで入り直された画面が残る）。
  await updateAccountPassword(deps.db, existing.id, passwordHash, false);
  await deleteSessionsByAccount(deps.db, existing.id);
  return { storeId: existing.storeId, created: false };
};

/** 種データが残す運営の操作の記録の理由（運営-01。誰が＝種を入れた運営・なぜ＝この文）。 */
const SEED_REASON = "デモの種データ";

/**
 * 承認済みにする。止められていれば承認済みへ戻す（既に承認済みなら何もしない）。
 * 承認は運営の画面と同じ repo の文で、承認した時点の写しと運営の操作の記録を同じまとまりで残す（運営-01・運営-02）。
 * 写しの条件（読んだ内容のまま）に使う店名・住所は、直前に当て直した `spec` の値。--print の集める役の db は
 * 読み取りを「無い」で返すので、読めなければ許可書は無し（新しく作った店）として組む。
 */
const approveDemoStore = async (deps: Deps, storeId: string, spec: DemoStoreSpec, actor: AdminActor): Promise<void> => {
  const read = (await findStoreReview(deps.db, storeId)) ?? { name: spec.name, address: spec.address, licenseKey: null };
  const approve = () => approvePendingStore(deps.db, storeId, read, newAdminAction(deps, actor, "approve", storeId, { reason: SEED_REASON }));
  if (await approve()) return;
  // 運営の画面で止めた店は、承認の写しが消えていて承認待ちへ戻る（2026-09-25 安全-20 のレビュー）。デモの店は
  // 承認済みへ戻すのが種の役目なので、そのまま承認し直す。
  if ((await restoreBannedStore(deps.db, storeId, newAdminAction(deps, actor, "restore", storeId, { reason: SEED_REASON }))) === "pending") await approve();
};

/**
 * クーポンが1枚も無ければ入れる。⚠️ 挿した直後に読み直さない——--print の集める役の db は読み取りを常に
 * 「無い」で返すので、挿した値をその場で使う。入れる文は店の画面と同じ「3つまで」の1文（不具合-13）を使い、
 * 入らなかったものは数えない。
 */
const ensureCoupons = async (deps: Deps, storeId: string, spec: DemoStoreSpec): Promise<Array<{ id: string }>> => {
  const existing = await listCoupons(deps.db, storeId);
  if (existing.length > 0) return existing;
  const inserted: Array<{ id: string }> = [];
  for (const coupon of spec.coupons) {
    const row = { id: newId(deps), storeId, name: coupon.name, note: coupon.note ?? "", createdAtIso: deps.clock.now().toISOString() };
    if (await insertCouponWithinLimit(deps.db, row, COUPON_MAX)) inserted.push(row);
  }
  return inserted;
};

/** 店1軒ぶん（店・アカウント・情報・承認・クーポン・オファー）を入れる。情報と承認は毎回当て直す。 */
const seedDemoStore = async (deps: Deps, spec: DemoStoreSpec, passwordHash: string, actor: AdminActor): Promise<DemoStoreResult> => {
  const { storeId, created } = await ensureStoreAccount(deps, spec, passwordHash);
  const { name, address, genres, menus, budgetMin, budgetMax, lat, lng } = spec;
  await updateStoreProfile(deps.db, storeId, { name, address, url: null, genres, menus, budgetMin, budgetMax, lat, lng });
  await approveDemoStore(deps, storeId, spec, actor);
  const coupons = await ensureCoupons(deps, storeId, spec);
  const now = deps.clock.now();
  // 入らなかった（公開中が既に在る）なら null（不具合-13 で真偽から「付けたクーポン」へ変わった）
  const offer = await insertOfferIfNone(deps.db, {
    id: newId(deps),
    storeId,
    capacity: spec.offer.capacity,
    partyMax: spec.offer.partyMax,
    publishedAtIso: now.toISOString(),
    untilAtIso: demoClosingTime(now).toISOString(),
    // デモの店は閉店の時刻を決めて出す（終了タイマーあり・店-05）
    untilSet: true,
    couponIds: coupons.map((c) => c.id),
  });
  return { email: spec.email, storeId, created, couponCount: coupons.length, offerInserted: offer !== null };
};

/**
 * デモを入れる（作り直す）。運営が先——別の運営がいて止まるときは、店にも何も書かない。
 * @throws {OtherAdminsExistError} 別のメールアドレスの運営がいて、番号も `allowAnotherAdmin: true` も渡されていない
 */
export const seedDemo = async (deps: Deps, input: SeedDemoInput): Promise<SeedDemoResult> => {
  const admin = await seedAdmin(deps, { ...input.admin, allowAnotherAdmin: input.admin.allowAnotherAdmin ?? false });
  const passwordHash = await hashPassword(deps, input.storePassword);
  const stores: DemoStoreResult[] = [];
  for (const spec of input.stores) stores.push(await seedDemoStore(deps, spec, passwordHash, { accountId: admin.accountId }));
  return { admin, stores };
};

/**
 * 本番のデモ店のパスワードだけを入れ替え、そのセッションを全部切る（README 5.3「本番のデモ店のパスワードを入れ替えるとき」・
 * 2026-09-26 のレビュー）。店・オファー・運営には触れない。メールアドレスで指す2文だけを流し、読み取りを挟まないので、
 * `--print` の集める役の db でもそのまま本番へ貼る文になる（デモ店が既に在る本番に seedDemo の --print を流すと店が二重にできる）。
 * 入れ替えてから切る（先に切ると、入れ替えまでの間に古いパスワードで入り直された画面が残る）。
 */
export const rotateDemoStorePasswords = async (deps: Deps, input: { storePassword: string; emails: readonly string[] }): Promise<void> => {
  // ログインの入口は8字未満を断るので、短い値に入れ替えると誰もデモ店に入れなくなる
  if (input.storePassword.length < PASSWORD_MIN) throw new Error(`店のパスワードは${PASSWORD_MIN}字以上にしてください`);
  if (input.emails.length === 0) return;
  const passwordHash = await hashPassword(deps, input.storePassword);
  await updateStorePasswordsByEmail(deps.db, input.emails, passwordHash);
  await deleteSessionsOfStoreAccountsByEmail(deps.db, input.emails);
};
