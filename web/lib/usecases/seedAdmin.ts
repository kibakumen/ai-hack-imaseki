// 運営のアカウントの投入（要件14の基準 14.8）。画面からは作れず、手元で走らせる
// web/scripts/seed-admin.mjs と受け入れ検査だけがここを呼ぶ。役割は必ず admin で、店は持たない。

import type { Deps } from "../ports";
import { findAccountByEmail, insertAccount, updateAccountPassword } from "../repo/accounts";
import { ID_BYTES } from "../schemas/limits";
import { tokenFromBytes } from "../domain/token";
import { hashPassword } from "./credentials";

export type SeedAdminResult = { accountId: string; created: boolean };

export const seedAdmin = async (deps: Deps, input: { email: string; password: string }): Promise<SeedAdminResult> => {
  const passwordHash = await hashPassword(deps, input.password);
  const existing = await findAccountByEmail(deps.db, input.email);

  if (existing) {
    // 店のアカウントを運営に変えない（1つのメールアドレスが指すアカウントは常に1つ・基準 12.2）。
    if (existing.role !== "admin") throw new Error("そのメールアドレスは店のアカウントに使われています");
    await updateAccountPassword(deps.db, existing.id, passwordHash);
    return { accountId: existing.id, created: false };
  }

  const accountId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  await insertAccount(deps.db, { id: accountId, email: input.email, role: "admin", storeId: null, passwordHash });
  return { accountId, created: true };
};
