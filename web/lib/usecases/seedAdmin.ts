// 運営のアカウントの投入（要件14の基準 14.8）。画面からは作れず、手元で走らせる
// web/scripts/seed-admin.mjs・seed-demo.mjs と受け入れ検査だけがここを呼ぶ。役割は必ず admin で、店は持たない。
//
// 2026-09-25（監査の指摘 安全-01）: 乗っ取られた運営を取り返す道として使えるようにした。
//   - 書く前に今いる運営の一覧を返す（adminsBefore）。メールアドレスを変えられていても、呼ぶ側が気づける
//   - パスワードを入れ替えたアカウントのセッションは全部切る。それまでは入れ替えても乗っ取った側の画面が残った
//   - 番号（accountId）を指せば、変えられたメールアドレスごと取り返せる。それまではメールアドレスで探すので、
//     元のアドレスで流し直しても2人目の運営ができるだけで、乗っ取られたアカウントはそのまま残った
//   - allowAnotherAdmin: false なら、別の運営がいるのに黙って2人目を作らない（スクリプトはこの形で呼ぶ）

import type { Deps } from "../ports";
import { findAccountByEmail, findAccountById, insertAccount, listAdminAccounts, updateAccountEmail, updateAccountPassword, type AdminSummary } from "../repo/accounts";
import { deleteSessionsByAccount } from "../repo/sessions";
import { ID_BYTES } from "../schemas/limits";
import { tokenFromBytes } from "../domain/token";
import { hashPassword } from "./credentials";

export type SeedAdminInput = {
  email: string;
  password: string;
  /** 入れ替える運営の番号。指せば、そのアカウントのメールアドレスとパスワードを入れ替える（取り返し） */
  accountId?: string;
  /**
   * 別のメールアドレスの運営が既にいるときに、新しく2人目を作ってよいか。既定は true
   * （検査の場面づくりが1つの D1 に何人も運営を作るため）。手で流すスクリプトは false を渡す。
   */
  allowAnotherAdmin?: boolean;
};

export type SeedAdminResult = { accountId: string; created: boolean; adminsBefore: AdminSummary[] };

/** 別の運営がいるので、2人目を作らずに止めた（何も書いていない）。今いる運営の一覧を持つ。 */
export class OtherAdminsExistError extends Error {
  readonly admins: AdminSummary[];

  constructor(admins: AdminSummary[]) {
    super(`運営のアカウントが既に${admins.length}件あります（${admins.map((a) => `${a.email} [${a.id}]`).join(", ")}）`);
    this.name = "OtherAdminsExistError";
    this.admins = admins;
  }
}

/** パスワード（と、指されたときはメールアドレス）を入れ替え、そのアカウントのセッションを全部切る。 */
const rotate = async (deps: Deps, accountId: string, passwordHash: string, email: string | null): Promise<void> => {
  if (email !== null) await updateAccountEmail(deps.db, accountId, email);
  await updateAccountPassword(deps.db, accountId, passwordHash);
  await deleteSessionsByAccount(deps.db, accountId);
};

/** 番号で指された運営を取り返す。無い番号・店のアカウント・別のアカウントのメールアドレスは断る（投げる）。 */
const reclaim = async (deps: Deps, accountId: string, input: SeedAdminInput, passwordHash: string, adminsBefore: AdminSummary[]): Promise<SeedAdminResult> => {
  const target = await findAccountById(deps.db, accountId);
  if (!target) throw new Error(`番号 ${accountId} のアカウントが見つかりません`);
  if (target.role !== "admin") throw new Error("その番号は店のアカウントです（運営に変えません）");
  const holder = await findAccountByEmail(deps.db, input.email);
  if (holder && holder.id !== target.id) throw new Error("そのメールアドレスは別のアカウントに使われています");
  await rotate(deps, target.id, passwordHash, input.email);
  return { accountId: target.id, created: false, adminsBefore };
};

export const seedAdmin = async (deps: Deps, input: SeedAdminInput): Promise<SeedAdminResult> => {
  const adminsBefore = await listAdminAccounts(deps.db);
  const passwordHash = await hashPassword(deps, input.password);
  if (input.accountId !== undefined) return reclaim(deps, input.accountId, input, passwordHash, adminsBefore);

  const existing = await findAccountByEmail(deps.db, input.email);
  if (existing) {
    // 店のアカウントを運営に変えない（1つのメールアドレスが指すアカウントは常に1つ・基準 12.2）。
    if (existing.role !== "admin") throw new Error("そのメールアドレスは店のアカウントに使われています");
    await rotate(deps, existing.id, passwordHash, null);
    return { accountId: existing.id, created: false, adminsBefore };
  }

  if (input.allowAnotherAdmin === false && adminsBefore.length > 0) throw new OtherAdminsExistError(adminsBefore);
  const accountId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  await insertAccount(deps.db, { id: accountId, email: input.email, role: "admin", storeId: null, passwordHash });
  return { accountId, created: true, adminsBefore };
};
